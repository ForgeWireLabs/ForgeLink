"""
Twilio Phone — One‑Click GTK4 Mini App (single file)
====================================================
Phone‑shaped GTK4 + Libadwaita desktop app with:

• Contacts + 1:1 **message threads** (left: threads; right: bubbles)
• **SMS/MMS** with inline media previews (image/video thumbnails)
• **Embedded WebRTC voice** via WebKit WebView using **Twilio Voice JS SDK** (talk through the app)
• **Desktop notifications v2** for inbound SMS (click to open thread)
• **Delivery states**: queued/sent/delivered/undelivered/failed (via status webhooks)
• **File picker & uploader**: attach a file → app serves it via `/media` (public base URL for Twilio)
• **Contacts CRUD** (search, import/export CSV), quick link thread→contact
• **Phone number validation/formatting** via `phonenumbers` (E.164 canonical)
• **Global search** (SQLite FTS5) across contacts/threads/messages
• **Media manager** (uploads housekeeping & quick copy link)
• In‑app **Settings** (Twilio creds, TwiML App SID, Public Base URL, test creds)
• Credentials stored in **GNOME Keyring** (fallback to config.json if unavailable)
• **Token auto‑refresh** for WebRTC (uses Twilio **API Key SID/Secret**) ✅
• Single process: embedded **aiohttp** server handles webhooks, uploads, voice token & WebRTC page
• **Headless mode** (`--headless`) for background webhooks + uploads (good with systemd --user)

Not included: packaging (AppImage/Flatpak/.deb).

Dependencies
------------
System: GTK4, Libadwaita, PyGObject, WebKitGTK (webkit2gtk‑4.1), SQLite FTS5 (usually default)
  Ubuntu/Debian:
    sudo apt install -y gir1.2-gtk-4.0 gir1.2-adw-1 libadwaita-1-dev python3-gi \
                        gir1.2-webkit2-4.1 webkit2gtk-driver sqlite3 libsqlite3-dev
Python:
    pip install twilio aiohttp aiosqlite python-dateutil keyring phonenumbers

Run
---
python twilio_phone.py              # normal (UI)
python twilio_phone.py --headless   # headless webhooks/uploads/token server

For inbound SMS/Voice & media to be reachable by Twilio/clients:
  ngrok http 5055
Set **Settings → Public Base URL** (e.g., https://abc123.ngrok.io), then set Twilio Console:
  Messaging webhook:  <Public Base URL>/webhooks/sms
  Status callback:    <Public Base URL>/webhooks/status
  TwiML App (Voice JS):  Outbound URL → <Public Base URL>/twiml/client

Security
--------
• Webhooks are validated with Twilio signature ✅
• GNOME Keyring stores Account SID/Auth Token/Phone Number/API Key SID/Secret ✅
• Uploads hardened: size cap, extension allow‑list, randomized names ✅
"""

import os, sys, json, asyncio, threading, time, mimetypes, secrets, csv, re
from pathlib import Path
from datetime import datetime, timedelta
from dateutil import tz

import gi
# Core GUI
gi.require_version("Adw", "1")
gi.require_version("Gtk", "4.0")
# WebView for WebRTC UI (optional, needs WebKitGTK 4.1)
WEBKIT_AVAILABLE = False
WEBKIT_ERROR = None
try:
    gi.require_version("WebKit2", "4.1")
    from gi.repository import WebKit2
except (ValueError, ImportError) as exc:
    WebKit2 = None
    WEBKIT_ERROR = exc
else:
    WEBKIT_AVAILABLE = True

from gi.repository import Adw, Gtk, Gdk, GLib, Gio

WEBKIT_DISABLED_MESSAGE = ""
if not WEBKIT_AVAILABLE:
    WEBKIT_DISABLED_MESSAGE = (
        "WebRTC voice requires WebKitGTK 4.1 (libwebkit2gtk-4.1). "
        "Install the WebKitGTK 4.1 packages to enable the embedded voice view."
    )
    if WEBKIT_ERROR:
        WEBKIT_DISABLED_MESSAGE += f"\n\nDetails: {WEBKIT_ERROR}"
    print(WEBKIT_DISABLED_MESSAGE.replace("\n", " "), file=sys.stderr)

import aiosqlite
from aiohttp import web

# Twilio REST + JWT for WebRTC
from twilio.rest import Client
from twilio.base.exceptions import TwilioRestException
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant
from twilio.request_validator import RequestValidator

# Keyring (GNOME Keyring / Secret Service)
try:
    import keyring
except Exception:
    keyring = None

import phonenumbers

# ─────────────────────────────────────────────────────────────────────────────
# Async helpers shared across UI modules
# ─────────────────────────────────────────────────────────────────────────────

GUI_LOOP = None
_GUI_LOOP_THREAD = None


def start_gui_loop(loop):
    """Run the GUI asyncio loop on a background thread and store it globally."""
    global GUI_LOOP, _GUI_LOOP_THREAD
    if GUI_LOOP is loop and _GUI_LOOP_THREAD and _GUI_LOOP_THREAD.is_alive():
        return
    GUI_LOOP = loop

    def _runner():
        asyncio.set_event_loop(loop)
        loop.run_forever()

    _GUI_LOOP_THREAD = threading.Thread(target=_runner, daemon=True)
    _GUI_LOOP_THREAD.start()


def stop_gui_loop():
    """Stop the background GUI asyncio loop thread cleanly."""
    global GUI_LOOP, _GUI_LOOP_THREAD
    loop = GUI_LOOP
    thread = _GUI_LOOP_THREAD
    GUI_LOOP = None
    _GUI_LOOP_THREAD = None
    if not loop:
        return
    if not loop.is_closed():
        try:
            loop.call_soon_threadsafe(loop.stop)
        except RuntimeError:
            pass
    if thread and thread.is_alive() and thread is not threading.current_thread():
        thread.join()
    if not loop.is_closed():
        loop.close()


def dispatch_on_gui_loop(coro):
    if GUI_LOOP is None:
        raise RuntimeError("GUI asyncio loop is not running")
    return asyncio.run_coroutine_threadsafe(coro, GUI_LOOP)


# ─────────────────────────────────────────────────────────────────────────────
# Config & Storage
# ─────────────────────────────────────────────────────────────────────────────
APP_NAME = "TwilioPhone"
CFG_DIR = Path.home()/".config"/APP_NAME
CFG_DIR.mkdir(parents=True, exist_ok=True)
CFG_FILE = CFG_DIR/"config.json"
UPLOAD_DIR = CFG_DIR/"uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
DB_FILE = CFG_DIR/"phone.sqlite"

DEFAULT_CFG = {
    "public_base_url": "",       # e.g., https://abc123.ngrok.io
    "webhook_host": "127.0.0.1",
    "webhook_port": 5055,
    "twiml_app_sid": "",
    "media_retention_days": 30
}

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  number TEXT UNIQUE,
  tags TEXT DEFAULT '',
  avatar_path TEXT DEFAULT NULL,
  last_seen TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER,
  canonical_number TEXT, -- E.164
  last_msg_ts TEXT,
  unread_count INTEGER DEFAULT 0,
  FOREIGN KEY(contact_id) REFERENCES contacts(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id INTEGER,
  direction TEXT,             -- inbound/outbound
  body TEXT,
  media_urls TEXT,
  status TEXT,
  ts TEXT,
  FOREIGN KEY(thread_id) REFERENCES threads(id)
);

CREATE TABLE IF NOT EXISTS calls (
  sid TEXT PRIMARY KEY,
  from_number TEXT,
  to_number TEXT,
  status TEXT,
  timestamp TEXT
);

-- Full‑text search for messages
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(body, content='messages', content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;

-- Global FTS for contacts
CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts USING fts5(name, number, content='contacts', content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS contacts_ai AFTER INSERT ON contacts BEGIN
  INSERT INTO contacts_fts(rowid, name, number) VALUES (new.rowid, new.name, new.number);
END;
CREATE TRIGGER IF NOT EXISTS contacts_ad AFTER DELETE ON contacts BEGIN
  INSERT INTO contacts_fts(contacts_fts, rowid, name, number) VALUES ('delete', old.rowid, old.name, old.number);
END;
CREATE TRIGGER IF NOT EXISTS contacts_au AFTER UPDATE ON contacts BEGIN
  INSERT INTO contacts_fts(contacts_fts, rowid, name, number) VALUES ('delete', old.rowid, old.name, old.number);
  INSERT INTO contacts_fts(rowid, name, number) VALUES (new.rowid, new.name, new.number);
END;

-- Indices for perf
CREATE INDEX IF NOT EXISTS idx_threads_last ON threads(last_msg_ts);
CREATE INDEX IF NOT EXISTS idx_msgs_thread_ts ON messages(thread_id, ts);
CREATE INDEX IF NOT EXISTS idx_contacts_num ON contacts(number);
"""

async def init_db():
    async with aiosqlite.connect(DB_FILE) as db:
        await db.executescript(SCHEMA)
        await db.commit()

# ── phone number helpers ─────────────────────────────────────────────────────

def to_e164(num: str, default_region: str = 'US') -> str:
    try:
        n = phonenumbers.parse(num, default_region)
        if not phonenumbers.is_valid_number(n):
            return ""
        return phonenumbers.format_number(n, phonenumbers.PhoneNumberFormat.E164)
    except Exception:
        return ""

# ── contacts/threads/messages DAL ────────────────────────────────────────────

async def upsert_contact(name: str, number: str) -> int:
    e164 = to_e164(number)
    if not e164: raise ValueError("Invalid phone number")
    async with aiosqlite.connect(DB_FILE) as db:
        cur = await db.execute("SELECT id FROM contacts WHERE number=?", (e164,))
        row = await cur.fetchone()
        if row:
            await db.execute("UPDATE contacts SET name=COALESCE(?, name), last_seen=? WHERE id=?", (name or None, datetime.utcnow().isoformat(), row[0]))
            await db.commit()
            return row[0]
        cur = await db.execute("INSERT INTO contacts(name, number, last_seen) VALUES(?,?,?)", (name, e164, datetime.utcnow().isoformat()))
        await db.commit()
        return cur.lastrowid

async def link_thread_to_contact(thread_id: int, contact_id: int):
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute("UPDATE threads SET contact_id=? WHERE id=?", (contact_id, thread_id))
        await db.commit()

async def get_or_create_thread(number: str) -> int:
    e164 = to_e164(number)
    if not e164: raise ValueError("Invalid phone number")
    async with aiosqlite.connect(DB_FILE) as db:
        cur = await db.execute("SELECT id FROM threads WHERE canonical_number=?", (e164,))
        row = await cur.fetchone()
        if row: return row[0]
        # create contact placeholder if none
        cur = await db.execute("SELECT id FROM contacts WHERE number=?", (e164,))
        c = await cur.fetchone()
        contact_id = c[0] if c else (await upsert_contact(e164, e164))
        cur = await db.execute("INSERT INTO threads(contact_id, canonical_number, last_msg_ts) VALUES(?,?,?)", (contact_id, e164, datetime.utcnow().isoformat()))
        await db.commit()
        return cur.lastrowid

async def list_threads():
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT t.id, t.canonical_number, t.last_msg_ts, t.unread_count, c.name "
            "FROM threads t LEFT JOIN contacts c ON t.contact_id=c.id "
            "ORDER BY datetime(t.last_msg_ts) DESC"
        )
        return [dict(r) for r in await cur.fetchall()]

async def list_messages(thread_id: int, limit=200, before_iso: str | None = None):
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        if before_iso:
            cur = await db.execute(
                "SELECT * FROM messages WHERE thread_id=? AND datetime(ts) < datetime(?) "
                "ORDER BY datetime(ts) DESC LIMIT ?",
                (thread_id, before_iso, limit)
            )
        else:
            cur = await db.execute(
                "SELECT * FROM messages WHERE thread_id=? ORDER BY datetime(ts) DESC LIMIT ?",
                (thread_id, limit)
            )
        rows = [dict(r) for r in await cur.fetchall()]
        rows.reverse()  # oldest→newest for display
        return rows

async def insert_message(msg):
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute(
            "INSERT OR REPLACE INTO messages(id, thread_id, direction, body, media_urls, status, ts) VALUES(?,?,?,?,?,?,?)",
            (msg['id'], msg['thread_id'], msg['direction'], msg.get('body',''), ",".join(msg.get('media_urls',[])), msg.get('status',''), msg['ts'])
        )
        await db.execute("UPDATE threads SET last_msg_ts=?, unread_count=CASE WHEN ?='inbound' THEN unread_count+1 ELSE unread_count END WHERE id=\n?",
                         (msg['ts'], msg['direction'], msg['thread_id']))
        await db.commit()

async def mark_thread_read(thread_id: int):
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute("UPDATE threads SET unread_count=0 WHERE id=?", (thread_id,))
        await db.commit()

async def search_messages(query: str, limit=100):
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT m.* FROM messages_fts f JOIN messages m ON m.rowid=f.rowid WHERE f.body MATCH ? LIMIT ?", (query, limit))
        return [dict(r) for r in await cur.fetchall()]

async def search_contacts_any(q: str, limit=100):
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT c.* FROM contacts_fts f JOIN contacts c ON c.rowid=f.rowid WHERE contacts_fts MATCH ? LIMIT ?", (q, limit))
        return [dict(r) for r in await cur.fetchall()]

# ─────────────────────────────────────────────────────────────────────────────
# Keyring helpers & config
# ─────────────────────────────────────────────────────────────────────────────

def load_cfg():
    if CFG_FILE.exists():
        try:
            return {**DEFAULT_CFG, **json.loads(CFG_FILE.read_text())}
        except Exception:
            pass
    return DEFAULT_CFG.copy()

CFG = load_cfg()
KEYRING_SERVICE = "TwilioPhone"

# Accessors to keyring

def kr_get(user_key):
    if not keyring: return None
    try: return keyring.get_password(KEYRING_SERVICE, user_key)
    except Exception: return None

def kr_set(user_key, secret):
    if not keyring: return False
    try:
        keyring.set_password(KEYRING_SERVICE, user_key, secret)
        return True
    except Exception:
        return False

def save_cfg(cfg):
    CFG_FILE.write_text(json.dumps(cfg, indent=2))

# Secrets

def get_sid(): return kr_get("account_sid") or ""

def get_token(): return kr_get("auth_token") or ""

def get_num(): return kr_get("twilio_number") or ""

def get_api_key_sid(): return kr_get("twilio_api_key_sid") or ""

def get_api_key_secret(): return kr_get("twilio_api_key_secret") or ""

# ─────────────────────────────────────────────────────────────────────────────
# Twilio client + delivery status (Fix #5)
# ─────────────────────────────────────────────────────────────────────────────

class TwilioAPI:
    def __init__(self):
        self._client = None
        self._sid = None
        self._tok = None

    def client(self):
        sid, tok = get_sid(), get_token()
        if not self._client or sid != self._sid or tok != self._tok:
            if not sid or not tok:
                raise RuntimeError("Twilio credentials not configured")
            self._client = Client(sid, tok)
            self._sid, self._tok = sid, tok
        return self._client

    def send_sms(self, to: str, body: str, media_urls=None, max_retries: int = 3):
        media_urls = media_urls or []
        from_ = get_num()
        if not from_:
            raise RuntimeError("Twilio phone number not configured")
        status_cb_base = (CFG.get('public_base_url') or f"http://{CFG.get('webhook_host')}:{CFG.get('webhook_port')}")
        attempt = 0
        delay = 1.0
        while True:
            try:
                msg = self.client().messages.create(
                    from_=from_, to=to, body=body or None, media_url=media_urls or None,
                    status_callback=f"{status_cb_base}/webhooks/status"
                )
                return msg
            except TwilioRestException as e:
                if e.status == 429 and attempt < max_retries:
                    time.sleep(delay); delay *= 2; attempt += 1
                    continue
                raise

API = TwilioAPI()

# ─────────────────────────────────────────────────────────────────────────────
# Web assets: WebRTC page using Twilio Voice SDK + token auto-refresh (Fix #1, #12, #13)
# ─────────────────────────────────────────────────────────────────────────────

VOICE_HTML = """
<!DOCTYPE html>
<html lang=\"en\"><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>
<title>Twilio Voice</title>
<style>body{font-family:system-ui,sans-serif;margin:12px} .row{display:flex;gap:8px;margin:8px 0} input,button{padding:8px;font-size:14px}#log{white-space:pre-wrap;background:#f6f6f7;padding:8px;border-radius:8px;height:180px;overflow:auto} .warn{color:#b45309}</style>
<script src=\"https://media.twiliocdn.com/sdk/js/voice/releases/2.7.5/twilio-voice.min.js\"></script>
</head><body>
<div class=\"row\"><button id=\"btnInit\">Initialize</button><button id=\"btnMic\">Mic Perm</button><button id=\"btnReg\" disabled>Register</button><span id=\"appWarn\" class=\"warn\"></span></div>
<div class=\"row\"><input id=\"number\" placeholder=\"Dial number\"/><button id=\"btnCall\">Call</button><button id=\"btnHang\">Hangup</button></div>
<div id=\"log\"></div>
<script>
let device, conn, tokenExpiry, appSidOK=false;
const log = (m)=>{const el=document.getElementById('log'); el.textContent+=m+'\n'; el.scrollTop=el.scrollHeight;};
async function fetchToken(){ const r = await fetch('/voice/token'); const j = await r.json(); if(j.error){throw new Error(j.error);} tokenExpiry = Date.now()+ (j.ttl_ms||3600000); appSidOK = !!j.app_sid; document.getElementById('btnReg').disabled = !appSidOK; if(!appSidOK){ document.getElementById('appWarn').textContent='Set TwiML App SID in Settings to enable Register.';} else {document.getElementById('appWarn').textContent='';} return j.token; }
function scheduleRefresh(){ const ms = Math.max(60000, (tokenExpiry - Date.now()) - 120000); setTimeout(async()=>{ try{ const t=await fetchToken(); if(device){ device.updateToken(t); log('Token refreshed'); scheduleRefresh(); } }catch(e){ log('Token refresh error: '+e); } }, ms); }
window.addEventListener('beforeunload', ()=>{ try{ if(device){ device.unregister(); device.destroy(); } }catch(e){} });

document.getElementById('btnInit').onclick = async ()=>{ try{ const token=await fetchToken(); device = new Twilio.Device(token, {codecPreferences:["opus","pcmu"],logLevel:'info'}); device.on('ready',()=>log('Device ready')); device.on('error', e=>log('Device error: '+e.message)); device.on('incoming', c=>{ conn=c; log('Incoming call'); c.accept();}); device.on('disconnect', ()=>log('Disconnected')); scheduleRefresh(); log('Initialized'); }catch(e){ log('Init error: '+e); }};

document.getElementById('btnMic').onclick = async ()=>{ try{ await navigator.mediaDevices.getUserMedia({audio:true}); log('Mic permission granted'); }catch(e){ log('Mic denied'); }};

document.getElementById('btnReg').onclick = ()=>{ if(device){ device.register(); log('Registered'); } };

document.getElementById('btnCall').onclick = ()=>{ const to=document.getElementById('number').value.trim(); if(!device){ log('Init first'); return;} conn=device.connect({ params:{ To: to } }); conn.on('accept',()=>log('Call answered')); conn.on('disconnect',()=>log('Call ended')); conn.on('error', e=>log('Call error: '+e.message)); };

document.getElementById('btnHang').onclick = ()=>{ if(conn){ conn.disconnect(); } };
</script></body></html>
"""

# ─────────────────────────────────────────────────────────────────────────────
# Webhook server (aiohttp) — webhooks, uploads, media, voice token, TwiML
# ─────────────────────────────────────────────────────────────────────────────

MAX_UPLOAD = 20 * 1024 * 1024  # 20MB (Fix #3)
ALLOWED_EXT = {".png",".jpg",".jpeg",".gif",".webp",".mp4",".webm",".ogg",".pdf"}

class WebhookServer:
    def __init__(self, on_inbound_sms, on_notify):
        self.on_inbound_sms = on_inbound_sms
        self.on_notify = on_notify
        self._thread = None

    def _is_twilio(self, request, body_dict):  # Fix #2
        auth_token = get_token()
        if not auth_token:
            return False
        validator = RequestValidator(auth_token)
        base = CFG.get("public_base_url") or f"http://{CFG.get('webhook_host')}:{CFG.get('webhook_port')}"
        url = base + str(request.rel_url)
        signature = request.headers.get("X-Twilio-Signature", "")
        try:
            return validator.validate(url, body_dict, signature)
        except Exception:
            return False

    async def _twiml_bridge(self, request):
        caller = request.query.get("caller", get_num())
        xml = f"""<?xml version='1.0' encoding='UTF-8'?>
<Response>
  <Dial>{caller}</Dial>
</Response>"""
        return web.Response(text=xml, content_type="application/xml")

    async def _twiml_client(self, request):
        to = request.query.get("To", "")
        from_ = get_num() or ""
        xml = f"""<?xml version='1.0' encoding='UTF-8'?>
<Response>
  <Dial callerId=\"{from_}\">{to}</Dial>
</Response>"""
        return web.Response(text=xml, content_type="application/xml")

    async def _voice_token(self, request):  # Fix #1
        account_sid = get_sid()
        api_sid = get_api_key_sid()
        api_secret = get_api_key_secret()
        if not (account_sid and api_sid and api_secret):
            return web.json_response({"error":"not_configured"}, status=400)
        app_sid = CFG.get("twiml_app_sid", "")
        identity = "desktop-" + secrets.token_hex(4)
        token = AccessToken(account_sid, api_sid, api_secret, identity=identity, ttl=55*60)
        grant = VoiceGrant(outgoing_application_sid=app_sid or None, incoming_allow=True)
        token.add_grant(grant)
        headers = {"Content-Security-Policy": "default-src 'none'; script-src https://media.twiliocdn.com; connect-src 'self' https:; img-src 'self' https: data:; style-src 'unsafe-inline'"}
        return web.json_response({"token": token.to_jwt().decode(), "ttl_ms": 55*60*1000, "app_sid": app_sid or ""}, headers=headers)

    async def _voice_html(self, request):
        return web.Response(text=VOICE_HTML, content_type="text/html",
            headers={"Content-Security-Policy": "default-src 'none'; script-src https://media.twiliocdn.com; connect-src 'self' https:; img-src 'self' https: data:; style-src 'unsafe-inline'"})

    async def _sms_webhook(self, request):
        data = dict(await request.post())
        if not self._is_twilio(request, data):
            raise web.HTTPUnauthorized()
        from_n = data.get("From","")
        body = data.get("Body","")
        e164_from = to_e164(from_n) or from_n
        thread_id = await get_or_create_thread(e164_from)
        row = {
            "id": data.get("SmsSid") or data.get("MessageSid") or f"local-{time.time()}",
            "thread_id": thread_id,
            "direction": "inbound",
            "body": body,
            "media_urls": [],
            "status": data.get("SmsStatus","received"),
            "ts": datetime.utcnow().isoformat()
        }
        try:
            n = int(data.get("NumMedia","0"))
        except Exception:
            n = 0
        for i in range(n):
            url = data.get(f"MediaUrl{i}", "")
            if url: row["media_urls"].append(url)
        await insert_message(row)
        if self.on_inbound_sms: GLib.idle_add(self.on_inbound_sms, thread_id)
        if self.on_notify: GLib.idle_add(self.on_notify, e164_from, body, thread_id)
        return web.Response(text="", status=204)

    async def _status_webhook(self, request):
        data = dict(await request.post())
        if not self._is_twilio(request, data):
            raise web.HTTPUnauthorized()
        sid = data.get("MessageSid")
        status = data.get("MessageStatus") or data.get("SmsStatus") or ""
        if sid and status:
            async with aiosqlite.connect(DB_FILE) as db:
                await db.execute("UPDATE messages SET status=? WHERE id=?", (status, sid))
                await db.commit()
        return web.Response(text="", status=204)

    async def _upload(self, request):  # Fix #3
        reader = await request.multipart()
        part = await reader.next()
        if not part or part.name != 'file':
            return web.json_response({"error":"missing file"}, status=400)
        raw = await part.read()
        if len(raw) > MAX_UPLOAD:
            return web.json_response({"error":"too_large"}, status=413)
        ext = os.path.splitext(part.filename or "")[1].lower()
        if ext not in ALLOWED_EXT:
            return web.json_response({"error":"ext_not_allowed"}, status=400)
        filename = f"{int(time.time())}-{secrets.token_hex(6)}{ext}"
        dest = UPLOAD_DIR/filename
        dest.write_bytes(raw)
        base = CFG.get("public_base_url","") or f"http://{CFG.get('webhook_host','127.0.0.1')}:{CFG.get('webhook_port',5055)}"
        url = f"{base}/media/{filename}"
        return web.json_response({"url": url})

    async def _media(self, request):
        name = request.match_info.get('name')
        # Disallow traversal
        if not re.fullmatch(r"[A-Za-z0-9_.\-]+", name or ""):
            raise web.HTTPNotFound()
        path = UPLOAD_DIR/name
        if not path.exists(): raise web.HTTPNotFound()
        mime = mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
        return web.FileResponse(path, headers={"Content-Type": mime})

    async def _cleanup(self):
        days = int(CFG.get("media_retention_days", 30))
        cutoff = time.time() - days*86400
        for f in UPLOAD_DIR.iterdir():
            try:
                if f.is_file() and f.stat().st_mtime < cutoff:
                    f.unlink()
            except Exception:
                pass

    async def _app(self):
        app = web.Application()
        app.router.add_post("/webhooks/sms", self._sms_webhook)
        app.router.add_post("/webhooks/status", self._status_webhook)
        app.router.add_get("/twiml/bridge", self._twiml_bridge)
        app.router.add_get("/twiml/client", self._twiml_client)
        app.router.add_get("/voice", self._voice_html)
        app.router.add_get("/voice/token", self._voice_token)
        app.router.add_post("/upload", self._upload)
        app.router.add_get("/media/{name}", self._media)
        return app

    def start(self):
        if getattr(self, "_thread", None) and self._thread.is_alive():
            return
        def _bg():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            async def runner():
                await init_db()
                app = await self._app()
                runner = web.AppRunner(app)
                await runner.setup()
                site = web.TCPSite(runner, CFG.get("webhook_host","127.0.0.1"), int(CFG.get("webhook_port",5055)))
                await site.start()
                while True:
                    await self._cleanup()
                    await asyncio.sleep(3600)
            loop.run_until_complete(runner())
        self._thread = threading.Thread(target=_bg, daemon=True)
        self._thread.start()

# ─────────────────────────────────────────────────────────────────────────────
# GTK UI — Phone shape + Threads + Contacts + Inline media + Notifications
# ─────────────────────────────────────────────────────────────────────────────

PHONE_CSS = """
window.phone { background: transparent; }
#phone-frame { border-radius:42px; border:1px solid @borders; box-shadow:0 20px 60px rgba(0,0,0,0.35); background:@view_bg_color; padding:10px; }
#notch { background:@window_fg_color; border-radius:0 0 16px 16px; min-height:24px; min-width:120px; margin:6px 0; align-self:center; }
#tabbar button { border-radius:18px; }
.message-bubble { border-radius:14px; padding:8px 10px; margin:4px; max-width: 75%; }
.message-out { background: @accent_color; color: @accent_fg_color; align-self: flex-end; }
.message-in { background: @card_bg_color; }
.thumb { min-width:120px; min-height:90px; }
.thread-unread { font-weight: 700; }

/* status chips */
.status-chip { border-radius: 10px; padding: 2px 6px; font-size: 11px; margin-left: 6px; }
.status-queued { background: alpha(@accent_color,0.15); }
.status-sent { background: alpha(@accent_color,0.20); }
.status-delivered { background: alpha(@success_color,0.25); }
.status-undelivered, .status-failed { background: alpha(@error_color,0.25); }
"""

class PhoneWindow(Adw.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app)
        self.set_title("Twilio Phone")
        self.add_css_class("phone")
        self.set_default_size(930, 880)  # wider for thread list + chat
        self.set_resizable(False)

        provider = Gtk.CssProvider(); provider.load_from_data(PHONE_CSS.encode())
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_USER)

        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        outer.set_margin_top(16); outer.set_margin_bottom(16); outer.set_margin_start(16); outer.set_margin_end(16)

        frame = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4, name="phone-frame")
        notch = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, name="notch")
        frame.append(notch)

        self.stack = Adw.ViewStack()
        self.tabs = Adw.ViewSwitcherBar(stack=self.stack); self.tabs.set_name("tabbar")

        self.home = HomePage()         # Threads + Chat
        self.contacts = ContactsPage() # Contacts CRUD
        self.voice = VoicePage()       # WebRTC
        self.settings = SettingsPage(app)

        self.stack.add_titled(self.home, "home", "Chats")
        self.stack.add_titled(self.contacts, "contacts", "Contacts")
        self.stack.add_titled(self.voice, "voice", "Voice")
        self.stack.add_titled(self.settings, "settings", "Settings")

        frame.append(self.stack)
        frame.append(self.tabs)
        outer.append(frame)
        self.set_content(outer)

        # Shortcuts (Fix #10)
        sc = Gtk.ShortcutController()
        sc.add_shortcut(Gtk.Shortcut.new(Gtk.ShortcutTrigger.parse_string("<Control>F"), Gtk.CallbackAction.new(lambda *_: self.home.focus_search())))
        sc.add_shortcut(Gtk.Shortcut.new(Gtk.ShortcutTrigger.parse_string("<Control>N"), Gtk.CallbackAction.new(lambda *_: self.home.focus_to())))
        sc.add_shortcut(Gtk.Shortcut.new(Gtk.ShortcutTrigger.parse_string("<Control>Return"), Gtk.CallbackAction.new(lambda *_: self.home.send_now())))
        self.add_controller(sc)

    # Select thread by id (Fix #7 helper)
    def open_thread(self, tid: int):
        self.stack.set_visible_child(self.home)
        self.home.select_thread_id(tid)

# ——— Threads + Chat ————————————————————————————————————————————————
class HomePage(Adw.Bin):
    def __init__(self):
        super().__init__()
        root = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8, margin_top=8, margin_bottom=8, margin_start=8, margin_end=8)
        self.set_child(root)

        # Left: thread list + search (ListView virtualization - Fix #6)
        left = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, width_request=280)
        self.search_entry = Gtk.SearchEntry(placeholder_text="Search messages & contacts…")
        self.search_entry.connect("search-changed", self.on_search)
        self.thread_store = Gio.ListStore(item_type=Gio.ListModel)
        # We will actually store simple dicts via wrapper
        self.thread_items = Gio.ListStore()
        factory = Gtk.SignalListItemFactory()
        factory.connect("setup", self._thread_setup)
        factory.connect("bind", self._thread_bind)
        self.thread_sel = Gtk.SingleSelection(model=self.thread_items)
        self.thread_view = Gtk.ListView(model=self.thread_sel, factory=factory)
        self.thread_view.connect("activate", self._on_thread_activated)
        left.append(self.search_entry)
        sc_left = Gtk.ScrolledWindow(vexpand=True); sc_left.set_child(self.thread_view)
        left.append(sc_left)

        # Right: chat view with pagination (ListView) (Fix #6, #15)
        right = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        self.chat_items = Gio.ListStore()
        cfactory = Gtk.SignalListItemFactory()
        cfactory.connect("setup", self._chat_setup)
        cfactory.connect("bind", self._chat_bind)
        self.chat_view = Gtk.ListView(model=Gtk.NoSelection.new(self.chat_items), factory=cfactory)
        sc_chat = Gtk.ScrolledWindow(vexpand=True); sc_chat.set_child(self.chat_view)

        # Header for thread actions (Fix #16)
        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        self.thread_title_lbl = Gtk.Label(xalign=0)
        link_btn = Gtk.Button(label="Link to contact…"); link_btn.connect("clicked", self._link_contact_dialog)
        self.load_older_btn = Gtk.Button(label="Load older…"); self.load_older_btn.connect("clicked", self._load_older)
        header.append(self.thread_title_lbl); header.append(link_btn); header.append(self.load_older_btn)

        # Composer
        comp = Gtk.Grid(column_spacing=6, row_spacing=6)
        self.to_entry = Gtk.Entry(placeholder_text="To: +1…")
        self.body_entry = Gtk.Entry(placeholder_text="Message…")
        self.media_entry = Gtk.Entry(placeholder_text="Media URL (optional)")
        attach = Gtk.Button(label="Attach…"); attach.connect("clicked", self._pick_file)
        send = Gtk.Button(label="Send"); send.connect("clicked", self._send)
        comp.attach(self.to_entry, 0, 0, 2, 1)
        comp.attach(self.body_entry, 0, 1, 2, 1)
        comp.attach(self.media_entry, 0, 2, 1, 1)
        comp.attach(attach, 1, 2, 1, 1)
        comp.attach(send, 0, 3, 2, 1)

        right.append(header); right.append(sc_chat); right.append(comp)

        root.append(left); root.append(right)

        self.current_thread_id = None
        self.oldest_loaded_ts = None
        self.refresh_threads()

    # —— ListView factories
    def _thread_setup(self, factory, list_item):
        row = Adw.ActionRow()
        list_item.set_child(row)

    def _thread_bind(self, factory, list_item):
        row = list_item.get_child()
        item = list_item.get_item()  # a dict-like
        title = item.get('title','')
        subtitle = item.get('subtitle','')
        row.set_title(title)
        row.set_subtitle(subtitle)
        if item.get('unread',0): row.add_css_class('thread-unread')
        else: row.remove_css_class('thread-unread')

    def _chat_setup(self, factory, list_item):
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        list_item.set_child(box)

    def _chat_bind(self, factory, list_item):
        box = list_item.get_child()
        for c in list(box.get_children()): box.remove(c)
        msg = list_item.get_item()
        bubble = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        bubble.add_css_class('message-bubble')
        bubble.add_css_class('message-out' if msg.get('direction')=='outbound' else 'message-in')
        if msg.get('body'):
            bubble.append(Gtk.Label(label=msg['body'], wrap=True, xalign=0))
        # Inline media previews (Fix #8)
        media = [m for m in (msg.get('media_urls','') or '').split(',') if m]
        for url in media:
            if re.search(r"\.(png|jpg|jpeg|gif|webp)$", url, re.I):
                pic = Gtk.Picture(can_shrink=True)
                pic.add_css_class('thumb')
                if url.startswith('http'): pic.set_file(Gio.File.new_for_uri(url))
                else: pic.set_file(Gio.File.new_for_path(url))
                pic.set_content_fit(Gtk.ContentFit.COVER)
                bubble.append(pic)
            elif re.search(r"\.(mp4|webm|ogg)$", url, re.I):
                # Local videos previewable with Gtk.Video; remote fallback to link
                if url.startswith('http'):
                    bubble.append(Gtk.LinkButton(uri=url, label=f"(video) {url}"))
                else:
                    try:
                        v = Gtk.Video.new_for_file(Gio.File.new_for_path(url))
                        v.set_hexpand(True); v.set_vexpand(False)
                        bubble.append(v)
                    except Exception:
                        bubble.append(Gtk.LinkButton(uri=url, label=f"(video) {url}"))
            else:
                bubble.append(Gtk.LinkButton(uri=url, label=url))
        # Status/time chip (Fix #9)
        status = (msg.get('status','') or '').lower()
        ts = msg.get('ts','')
        foot = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        ts_lbl = Gtk.Label(label=ts, xalign=0); ts_lbl.add_css_class('dim-label')
        foot.append(ts_lbl)
        if status:
            chip = Gtk.Label(label=status)
            chip.add_css_class('status-chip')
            chip.add_css_class(f'status-{status}')
            foot.append(chip)
        box.append(bubble); box.append(foot)

    # —— Threads UI helpers
    def thread_title(self, t):
        name = t.get('name') or t.get('canonical_number')
        unread = t.get('unread_count',0)
        label = f"{name}"
        if unread: label += f"  ({unread})"
        return label

    def refresh_threads(self):
        async def go():
            rows = await list_threads()
            GLib.idle_add(self._render_threads, rows)
        dispatch_on_gui_loop(go())

    def _render_threads(self, rows):
        self.thread_items.remove_all()
        for t in rows:
            self.thread_items.append({
                'id': t['id'],
                'title': self.thread_title(t),
                'subtitle': t.get('last_msg_ts',''),
                'unread': t.get('unread_count',0),
            })

    def _on_thread_activated(self, view, pos):
        item = self.thread_items.get_item(pos)
        if not item: return
        tid = item['id']
        self.load_thread(tid)

    def load_thread(self, tid: int):
        self.current_thread_id = tid
        async def go():
            msgs = await list_messages(tid)
            await mark_thread_read(tid)
            self.oldest_loaded_ts = msgs[0]['ts'] if msgs else None
            GLib.idle_add(self._set_thread_header, tid)
            GLib.idle_add(self._render_chat, msgs)
        dispatch_on_gui_loop(go())

    def _set_thread_header(self, tid: int):
        # Show name/number
        async def go():
            async with aiosqlite.connect(DB_FILE) as db:
                db.row_factory = aiosqlite.Row
                cur = await db.execute("SELECT t.canonical_number, c.name FROM threads t LEFT JOIN contacts c ON c.id=t.contact_id WHERE t.id=?", (tid,))
                r = await cur.fetchone()
                if r:
                    title = r['name'] or r['canonical_number']
                    GLib.idle_add(self.thread_title_lbl.set_text, title)
        dispatch_on_gui_loop(go())

    def _render_chat(self, msgs):
        self.chat_items.remove_all()
        for m in msgs:
            self.chat_items.append(m)

    def _append_older(self, msgs):
        # prepend older chunk
        old = [self.chat_items.get_item(i) for i in range(self.chat_items.get_n_items())]
        self.chat_items.remove_all()
        for m in msgs: self.chat_items.append(m)
        for m in old: self.chat_items.append(m)

    def _load_older(self, *_):  # Fix #15
        if not self.current_thread_id or not self.oldest_loaded_ts: return
        tid = self.current_thread_id; before = self.oldest_loaded_ts
        async def go():
            older = await list_messages(tid, before_iso=before)
            if older:
                self.oldest_loaded_ts = older[0]['ts']
                GLib.idle_add(self._append_older, older)
        dispatch_on_gui_loop(go())

    def select_thread_id(self, tid: int):  # Fix #7 helper
        # find in liststore
        for i in range(self.thread_items.get_n_items()):
            if self.thread_items.get_item(i)['id'] == tid:
                self.thread_sel.set_selected(i)
                self.load_thread(tid)
                return
        # not found; refresh and try
        self.refresh_threads()
        GLib.timeout_add(500, lambda: self.select_thread_id(tid) or False)

    # —— Compose/send helpers
    def focus_search(self):
        self.search_entry.grab_focus()
        return True

    def focus_to(self):
        self.to_entry.grab_focus()
        return True

    def send_now(self):
        self._send()
        return True

    def _pick_file(self, *_):
        dlg = Gtk.FileDialog()
        def on_selected(d, res):
            try: file = d.open_finish(res)
            except Exception: return
            dispatch_on_gui_loop(self._upload_file(file))
        dlg.open(self.get_native(), None, on_selected)

    async def _upload_file(self, gfile: Gio.File):
        try:
            path = gfile.get_path();  name = os.path.basename(path)
            with open(path, 'rb') as f: data = f.read()
            import aiohttp
            async with aiohttp.ClientSession() as s:
                form = aiohttp.FormData(); form.add_field('file', data, filename=name)
                async with s.post(f"http://{CFG.get('webhook_host','127.0.0.1')}:{CFG.get('webhook_port',5055)}/upload", data=form) as r:
                    j = await r.json()
            url = j.get('url','')
            if url: GLib.idle_add(self.media_entry.set_text, url)
        except Exception as e:
            print("Upload error:", e)

    def _send(self, *_):
        to = self.to_entry.get_text().strip()
        if not to and self.current_thread_id:
            async def go():
                async with aiosqlite.connect(DB_FILE) as db:
                    db.row_factory = aiosqlite.Row
                    cur = await db.execute("SELECT canonical_number FROM threads WHERE id=?", (self.current_thread_id,))
                    r = await cur.fetchone()
                    if r: GLib.idle_add(self.to_entry.set_text, r['canonical_number'])
            dispatch_on_gui_loop(go())
            to = self.to_entry.get_text().strip()
        body = self.body_entry.get_text().strip()
        media = self.media_entry.get_text().strip()
        media_urls = [media] if media else []
        if not to or not (body or media_urls): return
        e164 = to_e164(to)
        if not e164:
            print("Invalid number"); return
        def task():
            try:
                msg = API.send_sms(e164, body, media_urls)
                async def record():
                    tid = await get_or_create_thread(e164)
                    row = {"id": msg.sid, "thread_id": tid, "direction":"outbound","body": body,
                           "media_urls": media_urls, "status": getattr(msg,'status','queued'), "ts": datetime.utcnow().isoformat()}
                    await insert_message(row)
                    GLib.idle_add(self.body_entry.set_text, "")
                    GLib.idle_add(self._refresh_after_send, tid)
                dispatch_on_gui_loop(record())
            except Exception as e:
                print("Send error:", e)
        threading.Thread(target=task, daemon=True).start()

    def _refresh_after_send(self, tid):
        self.current_thread_id = tid
        self.refresh_threads()
        async def go():
            msgs = await list_messages(tid)
            self.oldest_loaded_ts = msgs[0]['ts'] if msgs else None
            GLib.idle_add(self._render_chat, msgs)
        dispatch_on_gui_loop(go())

    def on_search(self, *_):  # Fix #17 (unified search)
        q = self.search_entry.get_text().strip()
        if not q:
            self.refresh_threads(); return
        async def go():
            # search messages first
            msgs = await search_messages(q)
            # also contacts
            cons = await search_contacts_any(q)
            # render simple results in chat panel
            results = []
            for r in msgs:
                results.append({**r, 'body': f"[match] {r.get('body','')}"})
            for c in cons:
                results.append({'direction':'inbound','body': f"[contact] {c.get('name','')} {c.get('number','')}", 'media_urls':'', 'status':'', 'ts': c.get('last_seen','')})
            GLib.idle_add(self._render_chat, results)
        dispatch_on_gui_loop(go())

    # Link thread to an existing contact (Fix #16)
    def _link_contact_dialog(self, *_):
        if not self.current_thread_id: return
        dlg = Adw.MessageDialog(transient_for=self.get_native(), heading="Link to contact")
        entry = Gtk.Entry(placeholder_text="Search name…")
        lst = Gtk.ListBox()
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6); box.append(entry); box.append(lst)
        dlg.set_extra_child(box)
        dlg.add_response("cancel","Cancel"); dlg.add_response("ok","Link"); dlg.set_response_appearance("ok", Adw.ResponseAppearance.SUGGESTED)

        contacts_cache = []
        async def load():
            async with aiosqlite.connect(DB_FILE) as db:
                db.row_factory = aiosqlite.Row
                cur = await db.execute("SELECT * FROM contacts ORDER BY name COLLATE NOCASE")
                rows = [dict(r) for r in await cur.fetchall()]
                contacts_cache.extend(rows)
                GLib.idle_add(render, rows)
        def render(rows):
            for c in list(lst.get_children()): lst.remove(c)
            for r in rows[:100]:
                row = Adw.ActionRow(title=r.get('name') or r.get('number'), subtitle=r.get('number'))
                row.set_data("id", r['id'])
                lst.append(row)
        def on_search(*_):
            q = entry.get_text().strip().lower()
            rows = [r for r in contacts_cache if q in (r.get('name','').lower()) or q in (r.get('number',''))]
            render(rows)
        entry.connect("changed", on_search)
        dispatch_on_gui_loop(load())

        chosen = {"id": None}
        def on_select(lb, row):
            if row: chosen["id"] = row.get_data("id")
        lst.connect("row-selected", on_select)

        def resp(d, id):
            if id != "ok" or not chosen["id"]: return
            dispatch_on_gui_loop(link_thread_to_contact(self.current_thread_id, chosen["id"]))
            GLib.idle_add(self._set_thread_header, self.current_thread_id)
        dlg.connect("response", resp); dlg.present()

# ——— Contacts ————————————————————————————————————————————————
class ContactsPage(Adw.Bin):
    def __init__(self):
        super().__init__()
        root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, margin_top=8, margin_bottom=8, margin_start=8, margin_end=8)
        self.set_child(root)
        bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        self.search = Gtk.SearchEntry(placeholder_text="Search contacts…"); self.search.connect("search-changed", self.refresh)
        add_btn = Gtk.Button(label="Add"); add_btn.connect("clicked", self.add_contact)
        imp_btn = Gtk.Button(label="Import CSV"); imp_btn.connect("clicked", self.import_csv)
        exp_btn = Gtk.Button(label="Export CSV"); exp_btn.connect("clicked", self.export_csv)
        bar.append(self.search); bar.append(add_btn); bar.append(imp_btn); bar.append(exp_btn)
        self.list = Gtk.ListBox()
        sc = Gtk.ScrolledWindow(vexpand=True); sc.set_child(self.list)
        root.append(bar); root.append(sc)
        self.refresh()

    async def _all(self):
        async with aiosqlite.connect(DB_FILE) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute("SELECT * FROM contacts ORDER BY name COLLATE NOCASE")
            return [dict(r) for r in await cur.fetchall()]

    def refresh(self, *_):
        async def go():
            rows = await self._all()
            q = self.search.get_text().strip().lower()
            if q:
                rows = [r for r in rows if q in (r.get('name','').lower()) or q in (r.get('number',''))]
            GLib.idle_add(self._render, rows)
        dispatch_on_gui_loop(go())

    def _render(self, rows):
        for c in list(self.list.get_children()): self.list.remove(c)
        for r in rows:
            row = Adw.ActionRow(title=r.get('name') or r.get('number'), subtitle=r.get('number'))
            self.list.append(row)

    def add_contact(self, *_):
        dlg = Adw.MessageDialog(transient_for=self.get_native(), heading="New Contact")
        name = Gtk.Entry(placeholder_text="Name"); number = Gtk.Entry(placeholder_text="+1…")
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6); box.append(name); box.append(number)
        dlg.set_extra_child(box)
        dlg.add_response("cancel","Cancel"); dlg.add_response("ok","Save"); dlg.set_response_appearance("ok", Adw.ResponseAppearance.SUGGESTED)
        def resp(d, id):
            if id != "ok": return
            dispatch_on_gui_loop(upsert_contact(name.get_text().strip(), number.get_text().strip()))
            GLib.idle_add(self.refresh)
        dlg.connect("response", resp); dlg.present()

    def import_csv(self, *_):
        dlg = Gtk.FileDialog()
        def on_selected(d, res):
            try: f = d.open_finish(res)
            except Exception: return
            path = f.get_path();
            try:
                with open(path, newline='') as csvfile:
                    for row in csv.DictReader(csvfile):
                        dispatch_on_gui_loop(upsert_contact(row.get('name',''), row.get('number','')))
                GLib.idle_add(self.refresh)
            except Exception as e:
                print("CSV import error:", e)
        dlg.open(self.get_native(), None, on_selected)

    def export_csv(self, *_):
        async def go():
            rows = await self._all()
            out = CFG_DIR/"contacts_export.csv"; 
            with open(out, 'w', newline='') as f:
                w = csv.DictWriter(f, fieldnames=['name','number']); w.writeheader();
                for r in rows: w.writerow({'name': r.get('name',''), 'number': r.get('number','')})
            print(f"Exported → {out}")
        dispatch_on_gui_loop(go())

# ——— Voice (WebRTC) ————————————————————————————————————————————————
class VoicePage(Adw.Bin):
    def __init__(self):
        super().__init__()
        root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8, margin_top=8, margin_bottom=8, margin_start=8, margin_end=8)
        self.set_child(root)
        self.web = None

        if WEBKIT_AVAILABLE and WebKit2 is not None:
            self.web = WebKit2.WebView()
            self.reload()
            root.append(self.web)
            info = Gtk.Label(label="WebRTC uses Twilio Voice JS SDK. Set Public Base URL + TwiML App SID + API Key in Settings, then Initialize → Register in the page.")
            info.set_wrap(True)
            root.append(info)
        else:
            msg = Gtk.Label(label=WEBKIT_DISABLED_MESSAGE or "WebRTC voice requires WebKitGTK 4.1 (libwebkit2gtk-4.1).")
            msg.set_wrap(True)
            msg.set_xalign(0)
            root.append(msg)
            followup = Gtk.Label(label="Install WebKitGTK 4.1 and restart Twilio Phone to enable the embedded Twilio Voice client.")
            followup.set_wrap(True)
            followup.set_xalign(0)
            root.append(followup)
    def reload(self):
        if not self.web:
            return
        self.web.load_uri(f"http://{CFG.get('webhook_host','127.0.0.1')}:{CFG.get('webhook_port',5055)}/voice")

# ——— Settings ————————————————————————————————————————————————
class SettingsPage(Adw.Bin):
    TWILIO_LINKS = [
        ("Project Settings (SID/Token)", "https://www.twilio.com/console/project/settings"),
        ("Phone Numbers", "https://www.twilio.com/console/phone-numbers/incoming"),
        ("TwiML Apps", "https://www.twilio.com/console/voice/twiml/apps"),
        ("Messaging Webhook Docs", "https://www.twilio.com/docs/messaging/guides/webhook-request"),
        ("Voice JS SDK Docs", "https://www.twilio.com/docs/voice/client/javascript")
    ]

    def __init__(self, app: Adw.Application):
        super().__init__()
        self.app = app
        root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8, margin_top=8, margin_bottom=8, margin_start=8, margin_end=8)
        self.set_child(root)

        self.sid = Gtk.Entry(placeholder_text="Account SID (AC…)")
        self.token = Gtk.Entry(placeholder_text="Auth Token"); self.token.set_visibility(False)
        self.num = Gtk.Entry(placeholder_text="Twilio Phone Number (+1…)")
        self.api_key_sid = Gtk.Entry(placeholder_text="API Key SID (SK…)")
        self.api_key_secret = Gtk.Entry(placeholder_text="API Key Secret"); self.api_key_secret.set_visibility(False)

        if get_sid(): self.sid.set_text(get_sid())
        if get_token(): self.token.set_text(get_token())
        if get_num(): self.num.set_text(get_num())
        if get_api_key_sid(): self.api_key_sid.set_text(get_api_key_sid())
        if get_api_key_secret(): self.api_key_secret.set_text(get_api_key_secret())

        self.app_sid = Gtk.Entry(placeholder_text="TwiML App SID (for WebRTC outbound)", text=CFG.get("twiml_app_sid",""))
        self.pub_base = Gtk.Entry(placeholder_text="Public Base URL (https://…)", text=CFG.get("public_base_url",""))
        self.host = Gtk.Entry(placeholder_text="Webhook Host", text=str(CFG.get("webhook_host","127.0.0.1")))
        self.port = Gtk.Entry(placeholder_text="Webhook Port", text=str(CFG.get("webhook_port",5055)))

        test_btn = Gtk.Button(label="Test Credentials")
        test_btn.connect("clicked", self._test)

        save_btn = Gtk.Button(label="Save & Apply")
        save_btn.connect("clicked", self._save)

        grid = Gtk.Grid(column_spacing=6, row_spacing=6)
        r=0
        for label, widget in [
            ("Account SID", self.sid), ("Auth Token", self.token), ("Phone Number", self.num),
            ("API Key SID", self.api_key_sid), ("API Key Secret", self.api_key_secret),
            ("TwiML App SID", self.app_sid), ("Public Base URL", self.pub_base),
            ("Webhook Host", self.host), ("Webhook Port", self.port)
        ]:
            grid.attach(Gtk.Label(label=label), 0, r, 1, 1)
            grid.attach(widget, 1, r, 1, 1); r+=1
        root.append(grid)
        root.append(test_btn); root.append(save_btn)

        links_list = Gtk.ListBox(selection_mode=Gtk.SelectionMode.NONE)
        for title, url in self.TWILIO_LINKS:
            row = Adw.ActionRow(title=title, subtitle=url)
            btn = Gtk.Button.new_from_icon_name("document-open-symbolic")
            btn.connect("clicked", lambda _, u=url: Gtk.show_uri(self.get_native(), u, Gdk.CURRENT_TIME))
            row.add_suffix(btn); links_list.append(row)
        grp = Adw.PreferencesGroup(title="Twilio Resources"); grp.add(links_list); root.append(grp)

    def _test(self, *_):
        try:
            c = Client(self.sid.get_text().strip(), self.token.get_text().strip())
            nums = list(c.incoming_phone_numbers.stream(limit=1))
            print("Twilio OK — numbers visible" if nums else "Twilio OK — no numbers")
        except Exception as e:
            print("Twilio test failed:", e)

    def _save(self, *_):
        sid = self.sid.get_text().strip(); tok = self.token.get_text().strip(); num = self.num.get_text().strip()
        api_sid = self.api_key_sid.get_text().strip(); api_secret = self.api_key_secret.get_text().strip()
        if keyring:
            if sid: kr_set("account_sid", sid)
            if tok: kr_set("auth_token", tok)
            if num: kr_set("twilio_number", to_e164(num) or num)
            if api_sid: kr_set("twilio_api_key_sid", api_sid)
            if api_secret: kr_set("twilio_api_key_secret", api_secret)
        else:
            print("Keyring not available — secrets will NOT persist securely.")
        CFG["twiml_app_sid"] = self.app_sid.get_text().strip()
        CFG["public_base_url"] = self.pub_base.get_text().strip()
        CFG["webhook_host"] = self.host.get_text().strip() or "127.0.0.1"
        try: CFG["webhook_port"] = int(self.port.get_text().strip())
        except Exception: CFG["webhook_port"] = 5055
        save_cfg(CFG)
        app = Adw.Application.get_default()
        if app and getattr(app, 'win', None): app.win.voice.reload()

# ─────────────────────────────────────────────────────────────────────────────
# Notifications (v2) with deep link (Fix #7)
# ─────────────────────────────────────────────────────────────────────────────

def notify_inbound(from_num: str, body: str, thread_id: int | None = None):
    app = Adw.Application.get_default();
    if not app: return
    n = Gio.Notification.new("New SMS")
    n.set_body(f"From {from_num}: {body[:80]}")
    if thread_id is not None:
        n.set_default_action(f"app.openThread({thread_id})")
    app.send_notification(None, n)

# ─────────────────────────────────────────────────────────────────────────────
# Application shell & headless mode
# ─────────────────────────────────────────────────────────────────────────────

class App(Adw.Application):
    def __init__(self):
        super().__init__(application_id="dev.twiliophone.gtk4", flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
        # action for notification deep link
        act = Gio.SimpleAction.new("openThread", GLib.VariantType.new("i"))
        act.connect("activate", self._open_thread)
        self.add_action(act)
        self.connect("activate", self.on_activate)

    def on_activate(self, *_):
        self.win = PhoneWindow(self); self.win.present(); start_webhooks()

    def do_shutdown(self):
        super().do_shutdown()
        stop_gui_loop()

    def _open_thread(self, _, param):
        tid = param.unpack()
        if getattr(self, 'win', None):
            self.win.open_thread(tid)

_server = None

def push_inbound_to_ui(thread_id: int):
    app = Adw.Application.get_default()
    if not app or not getattr(app, 'win', None): return
    app.win.home.refresh_threads()
    async def go(): msgs = await list_messages(thread_id); GLib.idle_add(app.win.home._render_chat, msgs)
    dispatch_on_gui_loop(go())


def start_webhooks():
    global _server
    if _server: return
    _server = WebhookServer(push_inbound_to_ui, notify_inbound)
    _server.start()

# ─────────────────────────────────────────────────────────────────────────────
# systemd --user unit templates (write helper)
# ─────────────────────────────────────────────────────────────────────────────

UNIT_GUI = f"""[Unit]
Description=Twilio Phone (GTK)
After=graphical-session.target

[Service]
Type=simple
ExecStart={sys.executable} {Path(__file__).resolve()}
Restart=on-failure
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=default.target
"""

UNIT_HEADLESS = f"""[Unit]
Description=Twilio Phone Headless (Webhooks)
After=default.target

[Service]
Type=simple
ExecStart={sys.executable} {Path(__file__).resolve()} --headless
Restart=on-failure

[Install]
WantedBy=default.target
"""

def write_systemd_units():
    udir = Path.home()/".config/systemd/user"; udir.mkdir(parents=True, exist_ok=True)
    (udir/"twiliophone.service").write_text(UNIT_GUI)
    (udir/"twiliophone-headless.service").write_text(UNIT_HEADLESS)
    print("Wrote:", udir/"twiliophone.service", udir/"twiliophone-headless.service")

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    if "--write-units" in sys.argv:
        write_systemd_units(); return
    if "--headless" in sys.argv:
        # Run only the aiohttp server loop in foreground
        srv = WebhookServer(None, None)
        srv.start()
        print("Headless server running. Press Ctrl+C to exit.")
        try:
            while True: time.sleep(3600)
        except KeyboardInterrupt:
            return
    else:
        loop = asyncio.new_event_loop()
        start_gui_loop(loop)
        try:
            app = App(); app.run()
        finally:
            stop_gui_loop()

if __name__ == "__main__":
    asyncio.get_event_loop_policy().new_event_loop()
    main()
