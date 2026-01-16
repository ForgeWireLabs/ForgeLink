(() => {
  const DEFAULT_SETTINGS = {
    account_sid: "",
    auth_token: "",
    twilio_number: "",
    api_key_sid: "",
    api_key_secret: "",
    public_base_url: "",
    webhook_host: "127.0.0.1",
    webhook_port: 5055,
    twiml_app_sid: ""
  };

  const SETTINGS_FIELDS = [
    { key: "account_sid", label: "Account SID", placeholder: "ACxxxxxxxx", type: "text" },
    { key: "auth_token", label: "Auth Token", placeholder: "Auth token", type: "password" },
    { key: "twilio_number", label: "Phone Number", placeholder: "+1…", type: "text" },
    { key: "api_key_sid", label: "API Key SID", placeholder: "SK…", type: "text" },
    { key: "api_key_secret", label: "API Key Secret", placeholder: "API secret", type: "password" },
    { key: "twiml_app_sid", label: "TwiML App SID", placeholder: "AP…", type: "text" },
    { key: "public_base_url", label: "Public Base URL", placeholder: "https://example.ngrok.io", type: "text" },
    { key: "webhook_host", label: "Webhook Host", placeholder: "127.0.0.1", type: "text" },
    { key: "webhook_port", label: "Webhook Port", placeholder: "5055", type: "number" }
  ];

  const API = {
    threads: async () => {
      if (!state.serverRunning || !state.baseUrl) return [];
      try {
        const r = await fetch(`${state.baseUrl}/api/threads`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (err) {
        console.error("Failed to load threads", err);
        return [];
      }
    },
    messages: async (threadId, before = null) => {
      if (!state.serverRunning || !state.baseUrl) return [];
      try {
        const url = `${state.baseUrl}/api/messages?thread_id=${threadId}${before ? `&before=${encodeURIComponent(before)}` : ""}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (err) {
        console.error("Failed to load messages", err);
        return [];
      }
    },
    send: async (payload) => {
      if (!state.serverRunning || !state.baseUrl) return { ok: false, error: "Server offline" };
      try {
        const r = await fetch(`${state.baseUrl}/api/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (err) {
        console.error("Failed to send message", err);
        return { ok: false, error: err?.message || String(err) };
      }
    },
    contacts: async (q = "") => {
      if (!state.serverRunning || !state.baseUrl) return [];
      try {
        const r = await fetch(`${state.baseUrl}/api/contacts${q ? `?q=${encodeURIComponent(q)}` : ""}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (err) {
        console.error("Failed to load contacts", err);
        return [];
      }
    },
    upsertContact: async (name, number) => {
      if (!state.serverRunning || !state.baseUrl) return { ok: false };
      try {
        const r = await fetch(`${state.baseUrl}/api/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, number })
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (err) {
        console.error("Failed to upsert contact", err);
        return { ok: false, error: err?.message || String(err) };
      }
    },
    linkThread: async (threadId, contactId) => {
      if (!state.serverRunning || !state.baseUrl) return { ok: false };
      try {
        const r = await fetch(`${state.baseUrl}/api/link-thread`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thread_id: threadId, contact_id: contactId })
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (err) {
        console.error("Failed to link thread", err);
        return { ok: false, error: err?.message || String(err) };
      }
    },
    upload: async (file) => {
      if (!state.serverRunning || !state.baseUrl) return { ok: false };
      try {
        const fd = new FormData(); fd.append("file", file);
        const r = await fetch(`${state.baseUrl}/upload`, { method: "POST", body: fd });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (err) {
        console.error("Upload failed", err);
        return { ok: false, error: err?.message || String(err) };
      }
    }
  };

  // State
  let state = {
    tab: "chats",               // chats | contacts | voice | settings
    threads: [],
    selectedThread: null,
    messages: [],
    oldestTs: null,
    polling: null,
    serverRunning: false,
    baseUrl: "",
    settings: { ...DEFAULT_SETTINGS },
    startingServer: false,
    setupError: ""
  };

  // Elements
  const root = document.getElementById("app");

  function h(tag, attrs={}, ...children) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k,v]) => {
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k === "on") Object.entries(v).forEach(([ev,fn]) => el.addEventListener(ev, fn));
      else if (v !== undefined && v !== null) el.setAttribute(k, v);
    });
    children.flat(2).filter(Boolean).forEach(c => el.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return el;
  }

  function fmtTime(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch { return iso; }
  }

  function computeBaseUrl(settings) {
    if (!settings) return "";
    const host = settings.webhook_host || DEFAULT_SETTINGS.webhook_host;
    const port = settings.webhook_port || DEFAULT_SETTINGS.webhook_port;
    return `http://${host}:${port}`;
  }

  // ---- Notifications (via Electron) ----
  function notify(title, body) {
    window.desktop?.notify?.(title, body);
  }

  function prepareSettingsPayload() {
    const payload = { ...state.settings };
    Object.keys(payload).forEach((key) => {
      if (typeof payload[key] === "string") {
        payload[key] = payload[key].trim();
      }
    });
    if (payload.webhook_port !== undefined) {
      const parsed = parseInt(payload.webhook_port, 10);
      payload.webhook_port = Number.isFinite(parsed) ? parsed : DEFAULT_SETTINGS.webhook_port;
    }
    if (!payload.webhook_host) {
      payload.webhook_host = DEFAULT_SETTINGS.webhook_host;
    }
    return payload;
  }

  async function launchServer() {
    if (state.startingServer) return;
    if (!window.desktop?.startServer) {
      state.setupError = "Desktop bridge unavailable";
      render();
      return;
    }
    state.setupError = "";
    state.startingServer = true;
    render();
    try {
      const payload = prepareSettingsPayload();
      const res = await window.desktop.startServer(payload);
      if (!res || !res.ok) {
        throw new Error(res?.error || "Failed to start server");
      }
      state.baseUrl = computeBaseUrl(payload);
    } catch (err) {
      state.setupError = err?.message || String(err);
      state.startingServer = false;
      render();
      return;
    }
  }

  async function shutdownServer() {
    if (!window.desktop?.stopServer) {
      state.setupError = "Desktop bridge unavailable";
      render();
      return;
    }
    state.setupError = "";
    try {
      await window.desktop.stopServer();
    } catch (err) {
      state.setupError = err?.message || String(err);
      render();
    }
  }

  function createCredentialsForm({ submitLabel, showStop }) {
    const fields = SETTINGS_FIELDS.map((field) => {
      const value = state.settings[field.key];
      const input = h("input", {
        type: field.type || "text",
        value: value === undefined || value === null ? "" : String(value),
        placeholder: field.placeholder || "",
        autocomplete: field.type === "password" ? "new-password" : "on",
        id: `cred-${field.key}`
      });
      input.addEventListener("input", (e) => {
        state.settings[field.key] = e.target.value;
      });
      return h("label", { class: "setup-field", for: `cred-${field.key}` },
        h("span", { class: "setup-label" }, field.label),
        input
      );
    });
    const submitText = state.startingServer ? "Starting…" : submitLabel;
    const submitBtn = h("button", {
      type: "submit",
      class: "primary",
      disabled: state.startingServer
    }, submitText);
    const actions = [submitBtn];
    if (showStop) {
      const stopBtn = h("button", {
        type: "button",
        disabled: state.startingServer,
        on: { click: () => shutdownServer() }
      }, "Stop server");
      actions.push(stopBtn);
    }
    const form = h("form", {
      class: "setup-form",
      on: {
        submit: (e) => {
          e.preventDefault();
          launchServer();
        }
      }
    },
      ...fields,
      h("div", { class: "setup-actions" }, actions)
    );
    return form;
  }

  function renderSetup() {
    const intro = h("div", { class: "setup-intro" },
      h("h1", {}, "Twilio Phone"),
      h("p", {}, "Enter your Twilio credentials and webhook details to start the bundled Python server."),
      h("p", { class: "setup-note" }, "Credentials are stored locally and only used to configure your private server.")
    );
    const form = createCredentialsForm({ submitLabel: "Start server", showStop: false });
    const status = state.setupError
      ? h("div", { class: "setup-error" }, state.setupError)
      : (state.startingServer ? h("div", { class: "setup-status" }, "Starting server…") : "");
    return h("div", { class: "setup" }, intro, form, status);
  }

  // ---- Tabs ----
  function tabButton(id, label) {
    return h("div", { class: `tab ${state.tab===id?"active":""}`, on:{ click: () => switchTab(id) } }, label);
  }
  function switchTab(id) {
    state.tab = id;
    if (id === "voice" && state.serverRunning) {
      window.desktop?.openVoice?.();
    }
    render();
  }

  // ---- Threads & Messages ----
  async function loadThreads() {
    if (!state.serverRunning) {
      state.threads = [];
      return;
    }
    const data = await API.threads();
    state.threads = data || [];
  }

  async function selectThread(threadId) {
    if (!state.serverRunning) return;
    state.selectedThread = threadId;
    const msgs = await API.messages(threadId);
    state.messages = msgs || [];
    state.oldestTs = (state.messages[0] && state.messages[0].ts) || null;
    render();
  }

  async function loadOlder() {
    if (!state.serverRunning || !state.selectedThread || !state.oldestTs) return;
    const older = await API.messages(state.selectedThread, state.oldestTs);
    if (older && older.length) {
      state.oldestTs = older[0].ts;
      state.messages = [...older, ...state.messages];
      render();
    }
  }

  async function sendMessage() {
    if (!state.serverRunning) return;
    const to = document.getElementById("to").value.trim();
    const body = document.getElementById("body").value.trim();
    const mediaField = document.getElementById("media").value.trim();
    const media = mediaField ? [mediaField] : [];
    if (!to || (!body && media.length === 0)) return;
    const res = await API.send({ to, body, media_urls: media });
    if (res && res.ok) {
      notify("Message sent", body || mediaField);
      // refresh thread view
      await loadThreads();
      if (state.selectedThread) {
        await selectThread(state.selectedThread);
      }
      document.getElementById("body").value = "";
      // keep media URL unless you want to clear it too
    }
  }

  function threadRow(t) {
    const name = t.name || t.canonical_number;
    return h("div", { class: "thread", on:{ click: ()=>selectThread(t.id) } },
      h("div", {},
        h("div", { class:"name" }, name),
        h("div", { class:"time" }, fmtTime(t.last_msg_ts || ""))
      ),
      h("div", {},
        t.unread_count ? h("span", { class:"unread" }, String(t.unread_count)) : ""
      )
    );
  }

  function msgBubble(m) {
    const dir = m.direction === "outbound" ? "out" : "in";
    const bubble = h("div", { class:`msg ${dir}` },
      m.body ? h("div", {}, m.body) : ""
    );

    // media
    const urls = (m.media_urls || "").split(",").filter(Boolean);
    urls.forEach(u => {
      if (/\.(png|jpe?g|gif|webp)$/i.test(u)) {
        const img = h("img", { class:"media-thumb", src: u });
        bubble.appendChild(img);
      } else {
        bubble.appendChild(h("a", { href:u, target:"_blank" }, u));
      }
    });

    const foot = h("div", { class:"foot" },
      h("span", {}, fmtTime(m.ts)),
      m.status ? h("span", {}, `· ${m.status}`) : ""
    );
    return h("div", {}, bubble, foot);
  }

  // ---- File upload (→ /upload returns public URL) ----
  async function pickAndUpload() {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const j = await API.upload(file);
        if (j && j.url) {
          document.getElementById("media").value = j.url;
        } else if (j && j.error) {
          notify("Upload failed", j.error);
        } else {
          notify("Upload failed", "Server unavailable");
        }
      } catch (e) {
        notify("Upload failed", String(e));
      }
    };
    input.click();
  }

  // ---- Contacts ----
  async function addContact() {
    if (!state.serverRunning) return;
    const name = prompt("Contact name?");
    const number = prompt("Contact number (E.164 or local US)?");
    if (!name || !number) return;
    const res = await API.upsertContact(name, number);
    if (res && res.ok) {
      notify("Contact saved", `${name} (${number})`);
      renderContacts();
    }
  }

  async function linkThreadToContact() {
    if (!state.serverRunning || !state.selectedThread) return;
    const q = prompt("Search contact name/number:");
    const contacts = await API.contacts(q || "");
    if (!contacts || !contacts.length) { notify("No contacts found", q || ""); return; }
    const choice = contacts[0]; // simple pick first for now; you can add a dialog selector.
    const res = await API.linkThread(state.selectedThread, choice.id);
    if (res && res.ok) {
      notify("Linked", `${choice.name || choice.number}`);
      loadThreads().then(render);
    }
  }

  // ---- Polling for updates & notifications ----
  async function poll() {
    if (!state.serverRunning) return;
    const beforeCounts = new Map(state.threads.map(t => [t.id, t.unread_count || 0]));
    await loadThreads();
    state.threads.forEach(t => {
      const prev = beforeCounts.get(t.id) || 0;
      if ((t.unread_count || 0) > prev) {
        notify("New SMS", `${t.name || t.canonical_number}`);
      }
    });
    if (state.selectedThread) {
      // opportunistically refresh current chat
      await selectThread(state.selectedThread);
    } else {
      render();
    }
  }

  function startPolling() {
    stopPolling();
    if (!state.serverRunning) return;
    state.polling = setInterval(poll, 5000);
  }

  function stopPolling() {
    if (state.polling) clearInterval(state.polling);
    state.polling = null;
  }

  // ---- Voice frame hook ----
  window.desktop?.onOpenVoice?.((url) => {
    const frame = document.getElementById("voiceframe");
    if (frame) frame.src = url;
  });

  // ---- Renderers ----
  function renderSidebar() {
    const list = state.threads.map(threadRow);
    const search = h("div", { class: "search" },
      h("input", { type:"search", placeholder:"Search…", on:{ input: (e)=> filterThreads(e.target.value) } })
    );
    return h("div", { class:"sidebar" }, search, h("div", { class:"threads" }, list));
  }

  function filterThreads(q) {
    const lower = (q || "").toLowerCase();
    const matches = state.threads.filter(t =>
      (t.name || "").toLowerCase().includes(lower) || (t.canonical_number || "").includes(q)
    );
    const threadsEl = root.querySelector(".threads");
    threadsEl.innerHTML = "";
    matches.map(threadRow).forEach(el => threadsEl.appendChild(el));
  }

  function renderChat() {
    const header = h("div", { class:"header" },
      h("div", { class:"name"}, state.threads.find(t => t.id===state.selectedThread)?.name || "Choose a thread"),
      state.selectedThread ? h("button", { class:"", on:{click: linkThreadToContact}}, "Link to contact…") : ""
    );

    const log = h("div", { class:"log" }, state.messages.map(msgBubble));

    const to = h("input", { id:"to", placeholder:"+1…", value: (()=> {
      const t = state.threads.find(t => t.id===state.selectedThread);
      return t ? (t.canonical_number || "") : "";
    })() });

    const body = h("input", { id:"body", placeholder:"Message…" });
    const media = h("input", { id:"media", placeholder:"Media URL (optional)" });
    const attach = h("button", { title:"Attach file", on:{click: pickAndUpload}}, "📎");
    const send = h("button", { class:"primary", on:{click: sendMessage}}, "Send");

    const composer = h("div", { class:"composer" }, to, body, attach, media, send);
    const loadolder = state.selectedThread ? h("button", { class:"", on:{click: loadOlder}}, "Load older…") : "";

    return h("div", { class:"chat" },
      header,
      h("div", { style:"padding: 8px;" }, loadolder),
      log,
      composer
    );
  }

  function renderContacts() {
    const wrapper = h("div", { class:"chat" },
      h("div", { class:"header" },
        h("div", { class:"name" }, "Contacts"),
        h("button", { on:{click: addContact} }, "Add")
      ),
      h("div", { class:"log" },
        h("div", {}, "Use the search in Chats to quickly find across messages & contacts. A richer contacts UI can be added here.")
      ),
      h("div", { class:"composer" },
        h("div", {}, " "),
        h("div", {}, " "),
        h("div", {}, " "),
        h("div", {}, " ")
      )
    );
    return wrapper;
  }

  function renderSettings() {
    const runningUrl = state.baseUrl || computeBaseUrl(state.settings);
    const statusText = state.startingServer
      ? "Restarting server…"
      : (state.serverRunning ? `Server running at ${runningUrl}` : "Server is not running.");
    const status = h("div", { class: "settings-status" }, statusText);
    const form = createCredentialsForm({
      submitLabel: state.serverRunning ? "Save & restart server" : "Start server",
      showStop: state.serverRunning
    });
    const feedback = state.setupError
      ? h("div", { class: "setup-error" }, state.setupError)
      : (state.startingServer ? h("div", { class: "setup-status" }, "Applying configuration…") : "");
    const help = h("div", { class: "settings-help" },
      h("p", {}, "Voice uses Chromium; open the Voice tab after the server starts to initialize the Twilio Voice SDK."),
      h("button", {
        class: "linkish",
        on: { click: () => window.desktop?.openExternal?.("https://www.twilio.com/console") }
      }, "Open Twilio Console")
    );
    return h("div", { class:"chat" },
      h("div", { class:"header" }, h("div", { class:"name" }, "Settings")),
      h("div", { class:"log settings-log" }, status, form, feedback, help),
      h("div", { class:"composer" },
        h("div", {}, " "),
        h("div", {}, " "),
        h("div", {}, " "),
        h("div", {}, " ")
      )
    );
  }

  function renderVoice() {
    return h("div", { class:"chat" },
      h("div", { class:"header" },
        h("div", { class:"name" }, "Voice (Twilio JS)"),
        h("div", {}, "This is your embedded /voice page served by Python")
      ),
      h("iframe", { id:"voiceframe", class:"voiceframe", src:"about:blank" }),
      h("div", { class:"composer" },
        h("div", {}, " "),
        h("div", {}, " "),
        h("div", {}, " "),
        h("div", {}, " ")
      )
    );
  }

  function render() {
    root.innerHTML = "";
    if (!state.serverRunning) {
      root.appendChild(renderSetup());
      return;
    }
    const left = renderSidebar();
    const right =
      state.tab === "chats" ? renderChat() :
      state.tab === "contacts" ? renderContacts() :
      state.tab === "voice" ? renderVoice() :
      renderSettings();

    const tabs = h("div", { class:"tabbar" },
      tabButton("chats", "Chats"),
      tabButton("contacts", "Contacts"),
      tabButton("voice", "Voice"),
      tabButton("settings", "Settings")
    );

    const notch = h("div", { class:"notch" });
    const main = h("div", { class:"main" }, left, right);
    const phone = h("div", { class:"phone" }, notch, main, tabs);

    root.appendChild(phone);
  }

  async function applyServerStatus(status) {
    const wasRunning = state.serverRunning;
    state.serverRunning = Boolean(status?.running);
    state.startingServer = false;
    if (status?.settings) {
      state.settings = { ...state.settings, ...status.settings };
    }
    if (status?.baseUrl) {
      state.baseUrl = status.baseUrl;
    } else if (state.serverRunning) {
      state.baseUrl = computeBaseUrl(state.settings);
    } else if (!state.baseUrl) {
      state.baseUrl = computeBaseUrl(state.settings);
    }
    if (state.serverRunning) {
      state.setupError = "";
      await loadThreads();
      render();
      startPolling();
      if (!wasRunning && state.tab === "voice") {
        window.desktop?.openVoice?.();
      }
    } else {
      stopPolling();
      state.selectedThread = null;
      state.messages = [];
      state.oldestTs = null;
      render();
    }
  }

  window.desktop?.onServerStatus?.((status) => {
    applyServerStatus(status);
  });

  // Boot
  (async () => {
    try {
      const status = await window.desktop?.getStatus?.();
      if (status) {
        await applyServerStatus(status);
      } else {
        state.baseUrl = computeBaseUrl(state.settings);
        render();
      }
    } catch (err) {
      console.error("Failed to read initial status", err);
      state.baseUrl = computeBaseUrl(state.settings);
      render();
    }
  })();
})();
