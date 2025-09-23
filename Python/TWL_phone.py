#!/usr/bin/env python3
"""
Twilio Phone — Headless Server (no GTK)
======================================

Feature set (server-only):
• Contacts + 1:1 message threads (SQLite, FTS5)
• SMS/MMS send + delivery states via status webhooks
• Inbound Messaging webhook (validates Twilio signature)
• File uploader → serves public URLs under /media (size cap + allow-list)
• Twilio Voice JS support: /voice page + /voice/token (API Key SID/Secret)
• TwiML endpoints: /twiml/client (outbound), /twiml/bridge (simple dial)
• JSON API for Electron/web UI:
    GET  /api/threads
    GET  /api/messages?thread_id=ID[&before=ISO8601]
    POST /api/send            {to, body, media_urls?[]}
    GET  /api/contacts[?q=...]
    POST /api/contacts        {name, number}
    POST /api/link-thread     {thread_id, contact_id}
• Health: GET /healthz
• Systemd user unit helper: --write-units
• Headless run: --headless (default if no args)

Security:
• Webhooks validated with Twilio signature
• Uploads hardened: 20MB cap, extension allow-list, randomized names
• Minimal CSP on /voice + /voice/token responses

Secrets:
- Uses GNOME Keyring if available. If not, you can set ENV vars:
    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_NUMBER,
    TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET
- Also persists non-secret config in ~/.config/TwilioPhone/config.json
"""

import os, sys, json, asyncio, threading, time, mimetypes, secrets, csv, re, argparse, logging
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any

# 3rd party
import aiosqlite
from aiohttp import web
from dateutil import tz
import phonenumbers

# Twilio
from twilio.rest import Client
from twilio.base.exceptions import TwilioRestException
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant
from twilio.request_validator import RequestValidator

# Keyring optional
try:
    import keyring
except Exception:
    keyring = None

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger("twilio_phone")

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
  canonical_number TEXT,
  last_msg_ts TEXT,
  unread_count INTEGER DEFAULT 0,
  FOREIGN KEY(contact_id) REFERENCES contacts(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id INTEGER,
  direction TEXT,  -- inbound/outbound
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

-- FTS for messages
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

-- FTS for contacts
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

CREATE INDEX IF NOT EXISTS idx_threads_last ON threads(last_msg_ts);
CREATE INDEX IF NOT EXISTS idx_msgs_thread_ts ON messages(thread_id, ts);
CREATE INDEX IF NOT EXISTS idx_contacts_num ON contacts(number);
"""

async def init_db():
    async with aiosqlite.connect(DB_FILE) as db:
        await db.executescript(SCHEMA)
        await db.commit()
        log.info("DB initialized at %s", DB_FILE)

def load_cfg():
    if CFG_FILE.exists():
        try:
            return {**DEFAULT_CFG, **json.loads(CFG_FILE.read_text())}
        except Exception:
            pass
    return DEFAULT_CFG.copy()

def save_cfg(cfg):
    CFG_FILE.write_text(json.dumps(cfg, indent=2))

CFG = load_cfg()
KEYRING_SERVICE = "TwilioPhone"

# ─────────────────────────────────────────────────────────────────────────────
# Secrets
# ─────────────────────────────────────────────────────────────────────────────

def _kr_get(k):
    if keyring:
        try: return keyring.get_password(KEYRING_SERVICE, k)
        except Exception: return None
    return None

def get_sid(): return _kr_get("account_sid") or os.getenv("TWILIO_ACCOUNT_SID","")
def get_token(): return _kr_get("auth_token") or os.getenv("TWILIO_AUTH_TOKEN","")
def get_num(): return _kr_get("twilio_number") or os.getenv("TWILIO_NUMBER","")
def get_api_key_sid(): return _kr_get("twilio_api_key_sid") or os.getenv("TWILIO_API_KEY_SID","")
def get_api_key_secret(): return _kr_get("twilio_api_key_secret") or os.getenv("TWILIO_API_KEY_SECRET","")

# ─────────────────────────────────────────────────────────────────────────────
# Helpers: phone, DAL
# ─────────────────────────────────────────────────────────────────────────────

def to_e164(num: str, default_region: str = 'US') -> str:
    try:
        n = phonenumbers.parse(num, default_region)
        if not phonenumbers.is_valid_number(n):
            return ""
        return phonenumbers.format_number(n, phonenumbers.PhoneNumberFormat.E164)
    except Exception:
        return ""

async def upsert_contact(name: str, number: str) -> int:
    e164 = to_e164(number)
    if not e164: raise ValueError("Invalid phone number")
    async with aiosqlite.connect(DB_FILE) as db:
        cur = await db.execute("SELECT id FROM contacts WHERE number=?", (e164,))
        row = await cur.fetchone()
        if row:
            await db.execute("UPDATE contacts SET name=COALESCE(?, name), last_seen=? WHERE id=?",
                             (name or None, datetime.utcnow().isoformat(), row[0]))
            await db.commit(); return row[0]
        cur = await db.execute("INSERT INTO contacts(name, number, last_seen) VALUES(?,?,?)",
                               (name, e164, datetime.utcnow().isoformat()))
        await db.commit(); return cur.lastrowid

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
        # ensure contact exists
        cur = await db.execute("SELECT id FROM contacts WHERE number=?", (e164,))
        c = await cur.fetchone()
        contact_id = c[0] if c else (await upsert_contact(e164, e164))
        cur = await db.execute("INSERT INTO threads(contact_id, canonical_number, last_msg_ts) VALUES(?,?,?)",
                               (contact_id, e164, datetime.utcnow().isoformat()))
        await db.commit()
        return cur.lastrowid

async def list_threads():
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT t.id, t.canonical_number, t.last_msg_ts, t.unread_count, c.name "
            "FROM threads t LEFT JOIN contacts c ON t.contact_id=c.id "
            "ORDER BY datetime(t.last_msg_ts) DESC")
        return [dict(r) for r in await cur.fetchall()]

async def list_messages(thread_id: int, limit=200, before_iso: Optional[str] = None):
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        if before_iso:
            cur = await db.execute(
                "SELECT * FROM messages WHERE thread_id=? AND datetime(ts) < datetime(?) "
                "ORDER BY datetime(ts) DESC LIMIT ?",
                (thread_id, before_iso, limit))
        else:
            cur = await db.execute(
                "SELECT * FROM messages WHERE thread_id=? ORDER BY datetime(ts) DESC LIMIT ?",
                (thread_id, limit))
        rows = [dict(r) for r in await cur.fetchall()]
        rows.reverse()
        return rows

async def insert_message(msg: Dict[str, Any]):
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute(
            "INSERT OR REPLACE INTO messages(id, thread_id, direction, body, media_urls, status, ts) "
            "VALUES(?,?,?,?,?,?,?)",
            (msg['id'], msg['thread_id'], msg['direction'],
             msg.get('body',''), ",".join(msg.get('media_urls',[])),
             msg.get('status',''), msg['ts'])
        )
        await db.execute(
            "UPDATE threads SET last_msg_ts=?, unread_count=CASE WHEN ?='inbound' THEN unread_count+1 ELSE unread_count END "
            "WHERE id=?",
            (msg['ts'], msg['direction'], msg['thread_id'])
        )
        await db.commit()

async def mark_thread_read(thread_id: int):
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute("UPDATE threads SET unread_count=0 WHERE id=?", (thread_id,))
        await db.commit()

async def search_contacts_any(q: str, limit=100):
    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT c.* FROM contacts_fts f JOIN contacts c ON c.rowid=f.rowid WHERE contacts_fts MATCH ? LIMIT ?",
            (q, limit))
        return [dict(r) for r in await cur.fetchall()]

# ─────────────────────────────────────────────────────────────────────────────
# Twilio API
# ─────────────────────────────────────────────────────────────────────────────

class TwilioAPI:
    def __init__(self):
        self._client = None
        self._sid = None
        self._tok = None

    def client(self):
        sid, tok = get_sid(), get_token()
        if not sid or not tok:
            raise RuntimeError("Twilio credentials not configured (Account SID/Auth Token)")
        if not self._client or sid != self._sid or tok != self._tok:
            self._client = Client(sid, tok)
            self._sid, self._tok = sid, tok
        return self._client

    def send_sms(self, to: str, body: str, media_urls: Optional[List[str]]=None, max_retries: int=3):
        media_urls = media_urls or []
        from_ = get_num()
        if not from_:
            raise RuntimeError("Twilio phone number not configured")
        status_cb_base = (CFG.get('public_base_url') or f"http://{CFG.get('webhook_host')}:{CFG.get('webhook_port')}")
        attempt, delay = 0, 1.0
        while True:
            try:
                msg = self.client().messages.create(
                    from_=from_, to=to, body=body or None,
                    media_url=media_urls or None,
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
# Web assets — Twilio Voice HTML
# ─────────────────────────────────────────────────────────────────────────────

VOICE_HTML = """
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Twilio Voice</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell, Noto Sans, sans-serif;margin:12px}
.row{display:flex;gap:8px;margin:8px 0}
input,button{padding:8px;font-size:14px}
#log{white-space:pre-wrap;background:#f6f6f7;padding:8px;border-radius:8px;height:180px;overflow:auto}
.warn{color:#b45309}
</style>
<script src="https://media.twiliocdn.com/sdk/js/voice/releases/2.7.5/twilio-voice.min.js"></script>
</head><body>
<h3>Twilio Voice</h3>
<div class="row">
  <button id="btnInit">Initialize</button>
  <button id="btnMic">Mic Perm</button>
  <button id="btnReg" disabled>Register</button>
  <span id="appWarn" class="warn"></span>
</div>
<div class="row">
  <input id="number" placeholder="Dial number"/>
  <button id="btnCall">Call</button>
  <button id="btnHang">Hangup</button>
</div>
<div id="log"></div>
<script>
let device, conn, tokenExpiry, appSidOK=false;
const log = (m)=>{const el=document.getElementById('log'); el.textContent+=m+'\\n'; el.scrollTop=el.scrollHeight;};
async function fetchToken(){
  const r = await fetch('/voice/token'); const j = await r.json();
  if(j.error){throw new Error(j.error);}
  tokenExpiry = Date.now()+ (j.ttl_ms||3600000); appSidOK = !!j.app_sid;
  document.getElementById('btnReg').disabled = !appSidOK;
  if(!appSidOK){ document.getElementById('appWarn').textContent='Set TwiML App SID in Settings to enable Register.'; }
  else { document.getElementById('appWarn').textContent=''; }
  return j.token;
}
function scheduleRefresh(){
  const ms = Math.max(60000, (tokenExpiry - Date.now()) - 120000);
  setTimeout(async()=>{
    try{
      const t=await fetchToken();
      if(device){ device.updateToken(t); log('Token refreshed'); scheduleRefresh(); }
    }catch(e){ log('Token refresh error: '+e); }
  }, ms);
}
window.addEventListener('beforeunload', ()=>{ try{ if(device){ device.unregister(); device.destroy(); } }catch(e){} });

document.getElementById('btnInit').onclick = async ()=>{
  try{
    const token=await fetchToken();
    device = new Twilio.Device(token, {codecPreferences:["opus","pcmu"],logLevel:'info'});
    device.on('ready',()=>log('Device ready'));
    device.on('error', e=>log('Device error: '+e.message));
    device.on('incoming', c=>{ conn=c; log('Incoming call'); c.accept();});
    device.on('disconnect', ()=>log('Disconnected'));
    scheduleRefresh(); log('Initialized');
  }catch(e){ log('Init error: '+e); }
};

document.getElementById('btnMic').onclick = async ()=>{
  try{ await navigator.mediaDevices.getUserMedia({audio:true}); log('Mic permission granted'); }
  catch(e){ log('Mic denied'); }
};

document.getElementById('btnReg').onclick = ()=>{ if(device){ device.register(); log('Registered'); } };

document.getElementById('btnCall').onclick = ()=>{
  const to=document.getElementById('number').value.trim();
  if(!device){ log('Init first'); return;}
  conn=device.connect({ params:{ To: to } });
  conn.on('accept',()=>log('Call answered'));
  conn.on('disconnect',()=>log('Call ended'));
  conn.on('error', e=>log('Call error: '+e.message));
};

document.getElementById('btnHang').onclick = ()=>{ if(conn){ conn.disconnect(); } };
</script></body></html>
"""

# ─────────────────────────────────────────────────────────────────────────────
# Web server (aiohttp)
# ─────────────────────────────────────────────────────────────────────────────

MAX_UPLOAD = 20 * 1024 * 1024  # 20 MB
ALLOWED_EXT = {".png",".jpg",".jpeg",".gif",".webp",".mp4",".webm",".ogg",".pdf"}

class WebhookServer:
    def __init__(self):
        self._thread = None

    # CORS
    @web.middleware
    async def _cors(self, request, handler):
        if request.method == "OPTIONS":
            return web.Response(headers=self._cors_headers())
        resp = await handler(request)
        for k,v in self._cors_headers().items():
            if k not in resp.headers:
                resp.headers[k] = v
        return resp

    def _cors_headers(self):
        return {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type,Authorization"
        }

    # Twilio signature
    def _is_twilio(self, request, body_dict):
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

    # TwiML
    async def _twiml_bridge(self, request):
        caller = request.query.get("caller", get_num() or "")
        xml = f"""<?xml version='1.0' encoding='UTF-8'?><Response><Dial>{caller}</Dial></Response>"""
        return web.Response(text=xml, content_type="application/xml")

    async def _twiml_client(self, request):
        to = request.query.get("To", "")
        from_ = get_num() or ""
        xml = f"""<?xml version='1.0' encoding='UTF-8'?><Response><Dial callerId="{from_}">{to}</Dial></Response>"""
        return web.Response(text=xml, content_type="application/xml")

    # Voice token + page
    async def _voice_token(self, request):
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
        headers = {
            "Content-Security-Policy": "default-src 'none'; script-src https://media.twiliocdn.com; "
                                       "connect-src 'self' https:; img-src 'self' https: data:; style-src 'unsafe-inline'"
        }
        return web.json_response(
            {"token": token.to_jwt().decode(), "ttl_ms": 55*60*1000, "app_sid": app_sid or ""},
            headers=headers
        )

    async def _voice_html(self, request):
        headers = {
            "Content-Security-Policy": "default-src 'none'; script-src https://media.twiliocdn.com; "
                                       "connect-src 'self' https:; img-src 'self' https: data:; style-src 'unsafe-inline'"
        }
        return web.Response(text=VOICE_HTML, content_type="text/html", headers=headers)

    # Webhooks: inbound + status
    async def _sms_webhook(self, request):
        data = dict(await request.post())
        if not self._is_twilio(request, data):
            raise web.HTTPUnauthorized()
        from_n = data.get("From",""); body = data.get("Body","")
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
        log.info("Inbound SMS from %s (thread %s): %s", e164_from, thread_id, body[:140])
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
        log.info("Status update: %s → %s", sid, status)
        return web.Response(text="", status=204)

    # Uploads / Media
    async def _upload(self, request):
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

    # JSON API
    async def _api_threads(self, request):
        rows = await list_threads()
        return web.json_response(rows)

    async def _api_messages(self, request):
        try:
            tid = int(request.query.get("thread_id", "0"))
        except Exception:
            return web.json_response([], status=400)
        before = request.query.get("before")
        rows = await list_messages(tid, before_iso=before)
        # mark read when fetching the latest (no before)
        if not before:
            await mark_thread_read(tid)
        return web.json_response(rows)

    async def _api_send(self, request):
        data = await request.json()
        to = (data.get("to","") or "").strip()
        body = (data.get("body","") or "").strip()
        media_urls = data.get("media_urls") or []
        if not to or (not body and not media_urls):
            return web.json_response({"ok": False, "error":"bad_request"}, status=400)
        e164 = to_e164(to) or to
        try:
            msg = API.send_sms(e164, body, media_urls)
            tid = await get_or_create_thread(e164)
            row = {
                "id": msg.sid, "thread_id": tid, "direction":"outbound",
                "body": body, "media_urls": media_urls,
                "status": getattr(msg,'status','queued'),
                "ts": datetime.utcnow().isoformat()
            }
            await insert_message(row)
            log.info("Sent SMS to %s (sid %s)", e164, msg.sid)
            return web.json_response({"ok": True, "sid": msg.sid, "thread_id": tid})
        except Exception as e:
            log.exception("Send failed")
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    async def _api_contacts(self, request):
        q = (request.query.get("q","") or "").strip()
        if q:
            rows = await search_contacts_any(q)
        else:
            async with aiosqlite.connect(DB_FILE) as db:
                db.row_factory = aiosqlite.Row
                cur = await db.execute("SELECT * FROM contacts ORDER BY name COLLATE NOCASE")
                rows = [dict(r) for r in await cur.fetchall()]
        return web.json_response(rows)

    async def _api_contacts_post(self, request):
        data = await request.json()
        try:
            cid = await upsert_contact(data.get("name",""), data.get("number",""))
            return web.json_response({"ok": True, "id": cid})
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=400)

    async def _api_link_thread(self, request):
        data = await request.json()
        try:
            await link_thread_to_contact(int(data.get("thread_id")), int(data.get("contact_id")))
            return web.json_response({"ok": True})
        except Exception as e:
            return web.json_response({"ok": False, "error": str(e)}, status=400)

    async def _health(self, request):
        return web.json_response({"ok": True})

    async def _app(self):
        app = web.Application(middlewares=[self._cors])
        # Health
        app.router.add_get("/healthz", self._health)
        # Webhooks/Voice/Uploads
        app.router.add_post("/webhooks/sms", self._sms_webhook)
        app.router.add_post("/webhooks/status", self._status_webhook)
        app.router.add_get("/twiml/bridge", self._twiml_bridge)
        app.router.add_get("/twiml/client", self._twiml_client)
        app.router.add_get("/voice", self._voice_html)
        app.router.add_get("/voice/token", self._voice_token)
        app.router.add_post("/upload", self._upload)
        app.router.add_get("/media/{name}", self._media)
        # JSON API for UI
        app.router.add_get("/api/threads", self._api_threads)
        app.router.add_get("/api/messages", self._api_messages)
        app.router.add_post("/api/send", self._api_send)
        app.router.add_get("/api/contacts", self._api_contacts)
        app.router.add_post("/api/contacts", self._api_contacts_post)
        app.router.add_post("/api/link-thread", self._api_link_thread)
        return app

    def start_foreground(self, host: str, port: int):
        async def runner():
            await init_db()
            app = await self._app()
            runner = web.AppRunner(app)
            await runner.setup()
            site = web.TCPSite(runner, host, port)
            await site.start()
            log.info("Server started at http://%s:%s", host, port)
            while True:
                await self._cleanup()
                await asyncio.sleep(3600)

        asyncio.run(runner())

# ─────────────────────────────────────────────────────────────────────────────
# systemd --user units
# ─────────────────────────────────────────────────────────────────────────────

UNIT_HEADLESS = f"""[Unit]
Description=Twilio Phone Headless (Webhooks/API)
After=default.target

[Service]
Type=simple
ExecStart={sys.executable} {Path(__file__).resolve()} --headless
Restart=on-failure
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=default.target
"""

def write_systemd_units():
    udir = Path.home()/".config/systemd/user"; udir.mkdir(parents=True, exist_ok=True)
    (udir/"twiliophone-headless.service").write_text(UNIT_HEADLESS)
    print("Wrote:", udir/"twiliophone-headless.service")

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Twilio Phone Headless Server")
    parser.add_argument("--headless", action="store_true", help="Run the web server (default)")
    parser.add_argument("--host", default=str(CFG.get("webhook_host","127.0.0.1")))
    parser.add_argument("--port", type=int, default=int(CFG.get("webhook_port",5055)))
    parser.add_argument("--write-units", action="store_true", help="Write systemd --user unit files and exit")
    parser.add_argument("--set", nargs=2, metavar=("KEY","VALUE"),
                        help="Set a config key (public_base_url|twiml_app_sid|webhook_host|webhook_port|media_retention_days)")
    args = parser.parse_args()

    if args.write_units:
        write_systemd_units()
        return

    if args.set:
        k, v = args.set
        if k == "webhook_port":
            try: v = int(v)
            except: print("webhook_port must be int"); return
        CFG[k] = v
        save_cfg(CFG)
        print(f"Saved {k}={v} to {CFG_FILE}")
        return

    # default: headless server
    host, port = args.host, args.port
    # persist host/port if changed
    if CFG.get("webhook_host") != host or int(CFG.get("webhook_port",5055)) != port:
        CFG["webhook_host"] = host; CFG["webhook_port"] = port; save_cfg(CFG)

    # sanity log for creds presence
    missing = []
    if not get_sid(): missing.append("TWILIO_ACCOUNT_SID")
    if not get_token(): missing.append("TWILIO_AUTH_TOKEN")
    if not get_num(): missing.append("TWILIO_NUMBER")
    if missing:
        log.warning("Missing Twilio secrets: %s", ", ".join(missing))

    WebhookServer().start_foreground(host, port)

if __name__ == "__main__":
    main()
