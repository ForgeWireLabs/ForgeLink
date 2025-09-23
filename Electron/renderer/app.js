(() => {
  // Backend base (Python)
  const HOST = "http://127.0.0.1:5055"; // Python headless server base
  const API = {
    threads: () => fetch(`${HOST}/api/threads`).then(r => r.json()),
    messages: (threadId, before=null) => fetch(`${HOST}/api/messages?thread_id=${threadId}${before?`&before=${encodeURIComponent(before)}`:''}`).then(r => r.json()),
    send: (payload) => fetch(`${HOST}/api/send`, { method:"POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(r => r.json()),
    contacts: (q="") => fetch(`${HOST}/api/contacts${q?`?q=${encodeURIComponent(q)}`:''}`).then(r => r.json()),
    upsertContact: (name, number) => fetch(`${HOST}/api/contacts`, { method:"POST", headers:{ "Content-Type": "application/json" }, body: JSON.stringify({ name, number })}).then(r=>r.json()),
    linkThread: (threadId, contactId) => fetch(`${HOST}/api/link-thread`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ thread_id: threadId, contact_id: contactId })}).then(r=>r.json()),
    upload: async (file) => {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch(`${HOST}/upload`, { method: "POST", body: fd });
      return r.json();
    }
  };

  // State
  let state = {
    tab: "chats",               // chats | contacts | voice | settings
    threads: [],
    selectedThread: null,
    messages: [],
    oldestTs: null,
    polling: null
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

  // ---- Notifications (via Electron) ----
  function notify(title, body) {
    window.desktop?.notify?.(title, body);
  }

  // ---- Tabs ----
  function tabButton(id, label) {
    return h("div", { class: `tab ${state.tab===id?"active":""}`, on:{ click: () => switchTab(id) } }, label);
  }
  function switchTab(id) {
    state.tab = id;
    if (id === "voice") {
      window.desktop?.openVoice?.();
    }
    render();
  }

  // ---- Threads & Messages ----
  async function loadThreads() {
    const data = await API.threads();
    state.threads = data || [];
  }

  async function selectThread(threadId) {
    state.selectedThread = threadId;
    const msgs = await API.messages(threadId);
    state.messages = msgs || [];
    state.oldestTs = (state.messages[0] && state.messages[0].ts) || null;
    render();
  }

  async function loadOlder() {
    if (!state.selectedThread || !state.oldestTs) return;
    const older = await API.messages(state.selectedThread, state.oldestTs);
    if (older && older.length) {
      state.oldestTs = older[0].ts;
      state.messages = [...older, ...state.messages];
      render();
    }
  }

  async function sendMessage() {
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
        if (j.url) document.getElementById("media").value = j.url;
      } catch (e) {
        notify("Upload failed", String(e));
      }
    };
    input.click();
  }

  // ---- Contacts ----
  async function addContact() {
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
    if (!state.selectedThread) return;
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
    if (state.polling) clearInterval(state.polling);
    state.polling = setInterval(poll, 5000);
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
    const layout = h("div", { class:"chat" },
      h("div", { class:"header" }, h("div", { class:"name" }, "Settings")),
      h("div", { class:"log" },
        h("div", {}, "Settings are stored in Electron and Python config."),
        h("div", { style:"margin-top: 10px" },
          h("div", {}, "Voice uses Chromium; click Voice tab then ‘Initialize’ & ‘Register’ in the page.")
        ),
        h("div", { style:"margin-top: 16px" },
          h("button", { on:{click: ()=>window.desktop?.openExternal?.("https://www.twilio.com/console")}}, "Open Twilio Console")
        )
      ),
      h("div", { class:"composer" },
        h("div", {}, " "),
        h("div", {}, " "),
        h("div", {}, " "),
        h("div", {}, " ")
      )
    );
    return layout;
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

  // Boot
  (async () => {
    await loadThreads();
    render();
    startPolling();
    // Auto-open voice when switching tab
    if (state.tab === "voice") window.desktop?.openVoice?.();
  })();
})();
