(() => {
  let HOST = "http://127.0.0.1:5055";

  const state = {
    view: "messages",
    threads: [],
    contacts: [],
    messages: [],
    selectedThread: null,
    oldestTs: null,
    search: "",
    contactSearch: "",
    error: "",
    loading: true,
    sending: false,
    uploading: false,
    attachment: "",
    config: null,
    desktopStatus: null,
    polling: null
  };

  const root = document.getElementById("app");

  async function request(path, options) {
    const response = await fetch(`${HOST}${path}`, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  const API = {
    threads: () => request("/api/threads"),
    messages: (threadId, before = null) => request(`/api/messages?thread_id=${threadId}${before ? `&before=${encodeURIComponent(before)}` : ""}`),
    send: (payload) => request("/api/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    contacts: (query = "") => request(`/api/contacts${query ? `?q=${encodeURIComponent(query)}` : ""}`),
    saveContact: (name, number) => request("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, number }) }),
    linkThread: (threadId, contactId) => request("/api/link-thread", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thread_id: threadId, contact_id: contactId }) }),
    config: () => request("/api/config-status"),
    upload: (file) => {
      const form = new FormData();
      form.append("file", file);
      return request("/upload", { method: "POST", body: form });
    }
  };

  const ICONS = {
    chat: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1-1.55V3h4v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.55 1H21v4h-.09A1.7 1.7 0 0 0 19.4 15z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    external: '<path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    check: '<path d="m20 6-11 11-5-5"/>',
    alert: '<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    inbox: '<path d="M4 4h16v16H4z"/><path d="M4 13h4l2 3h4l2-3h4"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
  };

  function h(tag, attrs = {}, ...children) {
    const element = tag === "svg"
      ? document.createElementNS("http://www.w3.org/2000/svg", "svg")
      : document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === "class") element.setAttribute("class", value);
      else if (key === "on") Object.entries(value).forEach(([event, handler]) => element.addEventListener(event, handler));
      else if (key === "text") element.textContent = value;
      else if (key === "html") element.innerHTML = value;
      else if (key === "value") element.value = value;
      else if (key === "checked") element.checked = value;
      else if (value !== undefined && value !== null && value !== false) element.setAttribute(key, value === true ? "" : value);
    });
    children.flat().filter((child) => child !== null && child !== undefined && child !== false && child !== "").forEach((child) => {
      element.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return element;
  }

  function icon(name, size = 20) {
    return h("svg", { class: "icon", width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", html: ICONS[name] || "" });
  }

  function initials(value = "?") {
    const parts = value.trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : value.slice(0, 2)).toUpperCase();
  }

  function selectedThread() {
    return state.threads.find((thread) => thread.id === state.selectedThread);
  }

  function displayName(item) {
    return item?.name || item?.canonical_number || item?.number || "Unknown";
  }

  function formatListTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString([], { month: "short", day: "numeric" });
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }

  function formatMessageTime(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function notify(title, body) {
    window.desktop?.notify?.(title, body);
  }

  async function loadThreads({ preserveError = false } = {}) {
    try {
      state.threads = await API.threads() || [];
      if (!preserveError) state.error = "";
    } catch (error) {
      state.error = `The local service is unavailable. ${error.message}`;
      throw error;
    }
  }

  async function loadContacts(query = "") {
    state.contacts = await API.contacts(query) || [];
  }

  async function selectThread(threadId) {
    state.selectedThread = threadId;
    state.loading = true;
    render();
    try {
      state.messages = await API.messages(threadId) || [];
      state.oldestTs = state.messages[0]?.ts || null;
      await loadThreads();
    } catch (error) {
      state.error = error.message;
    } finally {
      state.loading = false;
      render();
      requestAnimationFrame(scrollMessagesToBottom);
    }
  }

  function scrollMessagesToBottom() {
    const log = document.querySelector(".message-log");
    if (log) log.scrollTop = log.scrollHeight;
  }

  async function loadOlder() {
    if (!state.selectedThread || !state.oldestTs) return;
    try {
      const older = await API.messages(state.selectedThread, state.oldestTs);
      if (older?.length) {
        state.oldestTs = older[0].ts;
        state.messages = [...older, ...state.messages];
        render();
      }
    } catch (error) {
      state.error = error.message;
      render();
    }
  }

  async function sendMessage() {
    const toInput = document.getElementById("recipient");
    const bodyInput = document.getElementById("message-body");
    const to = toInput?.value.trim() || "";
    const body = bodyInput?.value.trim() || "";
    if (!to || (!body && !state.attachment) || state.sending) return;
    state.sending = true;
    renderComposerOnly();
    try {
      await API.send({ to, body, media_urls: state.attachment ? [state.attachment] : [] });
      state.attachment = "";
      await loadThreads();
      const thread = state.threads.find((item) => item.canonical_number === to) || selectedThread();
      if (thread) await selectThread(thread.id);
      notify("Message sent", body || "Attachment sent");
    } catch (error) {
      state.error = error.message;
      notify("Message failed", error.message);
      render();
    } finally {
      state.sending = false;
      renderComposerOnly();
    }
  }

  function renderComposerOnly() {
    const existing = document.querySelector(".composer-wrap");
    if (!existing) return;
    existing.replaceWith(renderComposer());
    document.getElementById("message-body")?.focus();
  }

  async function pickAndUpload() {
    const input = h("input", { type: "file", accept: "image/*,.pdf,.txt" });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      state.uploading = true;
      renderComposerOnly();
      try {
        const result = await API.upload(file);
        state.attachment = result.url || "";
      } catch (error) {
        state.error = error.message;
        notify("Upload failed", error.message);
      } finally {
        state.uploading = false;
        render();
      }
    });
    input.click();
  }

  function openModal({ title, eyebrow, body, submitLabel = "Save", onSubmit }) {
    const overlay = h("div", { class: "modal-overlay", on: { mousedown: (event) => { if (event.target === overlay) overlay.remove(); } } });
    const form = h("form", { class: "modal-card", on: { submit: async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await onSubmit(new FormData(form));
        overlay.remove();
      } catch (error) {
        const errorBox = form.querySelector(".modal-error");
        errorBox.textContent = error.message;
        errorBox.hidden = false;
      } finally {
        submit.disabled = false;
      }
    } } },
      h("div", { class: "modal-head" },
        h("div", {}, h("div", { class: "eyebrow" }, eyebrow), h("h2", {}, title)),
        h("button", { class: "icon-button", type: "button", "aria-label": "Close", on: { click: () => overlay.remove() } }, icon("close"))
      ),
      h("div", { class: "modal-body" }, body, h("div", { class: "modal-error", hidden: true })),
      h("div", { class: "modal-actions" },
        h("button", { class: "button secondary", type: "button", on: { click: () => overlay.remove() } }, "Cancel"),
        h("button", { class: "button primary", type: "submit" }, submitLabel)
      )
    );
    overlay.appendChild(form);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => form.querySelector("input")?.focus());
  }

  function openNewMessage() {
    const body = h("div", { class: "form-stack" },
      field("Phone number", h("input", { name: "number", type: "tel", placeholder: "+1 555 123 4567", required: true, autocomplete: "tel" })),
      field("Message", h("textarea", { name: "message", placeholder: "Write a message...", rows: "4", required: true }))
    );
    openModal({ title: "New message", eyebrow: "Compose", body, submitLabel: "Start conversation", onSubmit: async (data) => {
      await API.send({ to: data.get("number"), body: data.get("message"), media_urls: [] });
      await loadThreads();
      const thread = state.threads.find((item) => item.canonical_number.endsWith(String(data.get("number")).replace(/\D/g, "").slice(-10)));
      if (thread) await selectThread(thread.id);
      state.view = "messages";
      render();
    } });
  }

  function openAddContact(defaultNumber = "") {
    const body = h("div", { class: "form-stack" },
      field("Name", h("input", { name: "name", placeholder: "Contact name", required: true, autocomplete: "name" })),
      field("Phone number", h("input", { name: "number", type: "tel", value: defaultNumber, placeholder: "+1 555 123 4567", required: true, autocomplete: "tel" }))
    );
    openModal({ title: "Add contact", eyebrow: "Contacts", body, submitLabel: "Save contact", onSubmit: async (data) => {
      await API.saveContact(data.get("name"), data.get("number"));
      await Promise.all([loadContacts(state.contactSearch), loadThreads()]);
      render();
      notify("Contact saved", String(data.get("name")));
    } });
  }

  async function linkCurrentThread() {
    const thread = selectedThread();
    if (!thread) return;
    await loadContacts();
    const options = state.contacts.length
      ? state.contacts.map((contact) => h("button", { class: "contact-picker-row", type: "button", on: { click: async () => {
          await API.linkThread(thread.id, contact.id);
          document.querySelector(".modal-overlay")?.remove();
          await loadThreads();
          render();
        } } }, avatar(displayName(contact), "small"), h("span", {}, h("strong", {}, displayName(contact)), h("small", {}, contact.number)), icon("chevron", 16)))
      : [h("div", { class: "empty-inline" }, "No contacts yet.")];
    openModal({ title: "Link contact", eyebrow: displayName(thread), body: h("div", { class: "contact-picker" }, options), submitLabel: "Add new contact", onSubmit: async () => openAddContact(thread.canonical_number) });
  }

  function field(label, control, hint = "") {
    return h("label", { class: "field" }, h("span", {}, label), control, hint ? h("small", {}, hint) : null);
  }

  function avatar(name, size = "regular") {
    return h("div", { class: `avatar ${size}`, "aria-hidden": "true" }, initials(name));
  }

  function navButton(view, label, iconName) {
    return h("button", { class: `nav-button ${state.view === view ? "active" : ""}`, title: label, "aria-label": label, on: { click: async () => {
      state.view = view;
      if (view === "contacts") await loadContacts();
      if (view === "settings" && !state.config) state.config = await API.config().catch(() => null);
      render();
    } } }, icon(iconName), h("span", {}, label));
  }

  function renderRail() {
    return h("nav", { class: "rail", "aria-label": "Primary navigation" },
      h("div", { class: "brand-mark", title: "Twilio Phone" }, "T"),
      h("div", { class: "rail-nav" },
        navButton("messages", "Messages", "chat"),
        navButton("contacts", "Contacts", "users"),
        navButton("settings", "Settings", "settings")
      ),
      h("div", { class: "rail-footer" }, h("span", { class: "status-dot online", title: "Local service connected" }))
    );
  }

  function filteredThreads() {
    const query = state.search.trim().toLowerCase();
    if (!query) return state.threads;
    return state.threads.filter((thread) => displayName(thread).toLowerCase().includes(query) || thread.canonical_number.includes(query));
  }

  function renderThreadRow(thread) {
    const name = displayName(thread);
    return h("button", { class: `thread-row ${state.selectedThread === thread.id ? "selected" : ""}`, on: { click: () => selectThread(thread.id) } },
      avatar(name),
      h("span", { class: "thread-content" },
        h("span", { class: "thread-line" }, h("strong", {}, name), h("time", {}, formatListTime(thread.last_msg_ts))),
        h("span", { class: "thread-line preview" },
          h("span", {}, thread.canonical_number),
          thread.unread_count ? h("span", { class: "unread-badge" }, thread.unread_count > 99 ? "99+" : String(thread.unread_count)) : null
        )
      )
    );
  }

  function renderConversationList() {
    const threads = filteredThreads();
    return h("aside", { class: "conversation-panel" },
      h("header", { class: "panel-title" },
        h("div", {}, h("span", { class: "eyebrow" }, "Workspace"), h("h1", {}, "Messages")),
        h("button", { class: "icon-button accent", title: "New message", "aria-label": "New message", on: { click: openNewMessage } }, icon("plus"))
      ),
      h("label", { class: "search-box" }, icon("search", 18), h("input", { type: "search", value: state.search, placeholder: "Search conversations", "aria-label": "Search conversations", on: { input: (event) => { state.search = event.target.value; render(); } } })),
      h("div", { class: "list-heading" }, h("span", {}, "Recent"), h("span", {}, `${threads.length} conversations`)),
      h("div", { class: "thread-list" },
        threads.length ? threads.map(renderThreadRow) : h("div", { class: "list-empty" }, icon("inbox", 28), h("strong", {}, state.search ? "No matches" : "No conversations yet"), h("span", {}, state.search ? "Try another name or number." : "Start a message to begin."))
      )
    );
  }

  function renderMessage(message) {
    const outbound = message.direction === "outbound";
    const media = (message.media_urls || "").split(",").filter(Boolean);
    const content = h("div", { class: `bubble ${outbound ? "outbound" : "inbound"}` },
      message.body ? h("p", {}, message.body) : null,
      ...media.map((url) => /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(url)
        ? h("img", { class: "message-media", src: url, alt: "Message attachment", loading: "lazy" })
        : h("button", { class: "attachment-link", on: { click: () => window.desktop?.openExternal?.(url) } }, icon("paperclip", 16), "Open attachment")),
      h("div", { class: "message-meta" }, h("time", {}, formatMessageTime(message.ts)), outbound && message.status ? h("span", {}, message.status, message.status === "delivered" ? icon("check", 13) : null) : null)
    );
    return h("div", { class: `message-row ${outbound ? "outbound" : "inbound"}` }, content);
  }

  function renderComposer() {
    const thread = selectedThread();
    const to = thread?.canonical_number || "";
    return h("div", { class: "composer-wrap" },
      state.attachment ? h("div", { class: "attachment-chip" }, icon("paperclip", 16), h("span", {}, "Attachment ready"), h("button", { class: "chip-close", title: "Remove attachment", on: { click: () => { state.attachment = ""; renderComposerOnly(); } } }, icon("close", 14))) : null,
      h("div", { class: "composer" },
        h("input", { id: "recipient", class: "recipient-input", type: "tel", value: to, placeholder: "Phone number", "aria-label": "Recipient phone number" }),
        h("div", { class: "compose-main" },
          h("textarea", { id: "message-body", rows: "1", placeholder: thread ? `Message ${displayName(thread)}` : "Write a new message", "aria-label": "Message", on: { keydown: (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } } } }),
          h("button", { class: "icon-button composer-action", title: "Attach file", disabled: state.uploading, on: { click: pickAndUpload } }, state.uploading ? h("span", { class: "spinner" }) : icon("paperclip")),
          h("button", { class: "send-button", title: "Send message", disabled: state.sending, on: { click: sendMessage } }, state.sending ? h("span", { class: "spinner light" }) : icon("send", 19))
        )
      ),
      h("div", { class: "composer-hint" }, "Enter to send", h("span", {}, "Shift + Enter for a new line"))
    );
  }

  function renderChat() {
    const thread = selectedThread();
    if (!thread) {
      return h("main", { class: "content-panel welcome-panel" },
        h("div", { class: "welcome-art" }, icon("chat", 38)),
        h("span", { class: "eyebrow" }, "Twilio Phone"),
        h("h2", {}, "Your conversations, without the clutter."),
        h("p", {}, "Select a conversation from the left, or start a new message when you are ready."),
        h("button", { class: "button primary", on: { click: openNewMessage } }, icon("plus", 17), "New message")
      );
    }

    return h("main", { class: "content-panel chat-panel" },
      h("header", { class: "chat-header" },
        h("div", { class: "chat-identity" }, avatar(displayName(thread)), h("div", {}, h("h2", {}, displayName(thread)), h("span", {}, thread.canonical_number))),
        h("div", { class: "header-actions" },
          !thread.name ? h("button", { class: "button subtle", on: { click: () => openAddContact(thread.canonical_number) } }, icon("plus", 16), "Add contact") : null,
          h("button", { class: "icon-button", title: "Link contact", "aria-label": "Link contact", on: { click: linkCurrentThread } }, icon("more"))
        )
      ),
      h("div", { class: "message-log" },
        state.oldestTs && state.messages.length >= 200 ? h("button", { class: "load-older", on: { click: loadOlder } }, "Load earlier messages") : null,
        state.loading ? h("div", { class: "loading-state" }, h("span", { class: "spinner" }), "Loading conversation")
          : state.messages.length ? state.messages.map(renderMessage)
          : h("div", { class: "empty-chat" }, h("strong", {}, "This is the beginning"), h("span", {}, `Send the first message to ${displayName(thread)}.`))
      ),
      renderComposer()
    );
  }

  function renderContacts() {
    const query = state.contactSearch.toLowerCase();
    const contacts = state.contacts.filter((contact) => !query || displayName(contact).toLowerCase().includes(query) || contact.number.includes(query));
    return h("main", { class: "content-panel page-panel" },
      h("header", { class: "page-header" },
        h("div", {}, h("span", { class: "eyebrow" }, "Directory"), h("h1", {}, "Contacts"), h("p", {}, "Keep names attached to the numbers you message most.")),
        h("button", { class: "button primary", on: { click: () => openAddContact() } }, icon("plus", 17), "Add contact")
      ),
      h("div", { class: "page-toolbar" }, h("label", { class: "search-box wide" }, icon("search", 18), h("input", { type: "search", value: state.contactSearch, placeholder: "Search contacts", on: { input: (event) => { state.contactSearch = event.target.value; render(); } } })), h("span", { class: "count-label" }, `${contacts.length} contacts`)),
      h("div", { class: "contact-grid" }, contacts.length ? contacts.map((contact) => h("article", { class: "contact-card" },
        avatar(displayName(contact), "large"),
        h("div", { class: "contact-info" }, h("h3", {}, displayName(contact)), h("span", {}, contact.number)),
        h("button", { class: "icon-button", title: "Message contact", on: { click: async () => {
          state.view = "messages";
          const thread = state.threads.find((item) => item.canonical_number === contact.number);
          if (thread) await selectThread(thread.id); else openNewMessage();
        } } }, icon("chat", 18))
      )) : h("div", { class: "page-empty" }, icon("users", 32), h("h3", {}, "No contacts found"), h("p", {}, "Add a contact to make your conversations easier to recognize.")))
    );
  }

  function statusRow(label, configured) {
    return h("div", { class: "status-row" }, h("span", {}, label), h("span", { class: `config-pill ${configured ? "ready" : "missing"}` }, configured ? icon("check", 14) : icon("alert", 14), configured ? "Configured" : "Missing"));
  }

  function openConnectionSettings() {
    const current = state.desktopStatus?.settings || {};
    const body = h("div", { class: "form-stack" },
      field("Account SID", h("input", { name: "account_sid", value: current.account_sid || "", placeholder: "AC...", autocomplete: "off" })),
      field("Auth token", h("input", { name: "auth_token", type: "password", placeholder: current.auth_token_configured ? "Configured; enter to replace" : "Enter auth token", autocomplete: "new-password" }), "Stored with operating-system encryption. Leave blank to keep the current token."),
      field("Twilio number", h("input", { name: "twilio_number", type: "tel", value: current.twilio_number || "", placeholder: "+1 555 123 4567", autocomplete: "tel" })),
      field("Public webhook URL", h("input", { name: "public_base_url", type: "url", value: current.public_base_url || "", placeholder: "https://phone.example.com" })),
      field("Local host", h("input", { name: "webhook_host", value: current.webhook_host || "127.0.0.1", pattern: "127\\.0\\.0\\.1|localhost", required: true }), "Keep the service bound to loopback."),
      field("Local port", h("input", { name: "webhook_port", type: "number", value: current.webhook_port || 5055, min: "1024", max: "65535", required: true }))
    );
    openModal({ title: "Twilio connection", eyebrow: "Secure local settings", body, submitLabel: "Save and restart", onSubmit: async (data) => {
      const payload = Object.fromEntries(data.entries());
      payload.webhook_port = Number(payload.webhook_port);
      state.desktopStatus = await window.desktop.startServer(payload);
      HOST = state.desktopStatus.baseUrl;
      state.config = await API.config();
      render();
      notify("Connection settings saved", "The local service restarted with the new configuration.");
    } });
  }

  function renderSettings() {
    const config = state.config || {};
    return h("main", { class: "content-panel page-panel settings-page" },
      h("header", { class: "page-header" }, h("div", {}, h("span", { class: "eyebrow" }, "Application"), h("h1", {}, "Settings"), h("p", {}, "Connection health and the environment this app uses."))),
      h("div", { class: "settings-grid" },
        h("section", { class: "settings-card" },
          h("div", { class: "settings-card-head" }, h("div", { class: "settings-icon" }, icon("settings")), h("div", {}, h("h2", {}, "Twilio connection"), h("p", {}, "Credentials stay in the desktop process and are encrypted at rest."))),
          h("div", { class: "status-list" },
            statusRow("Account SID", config.account_sid),
            statusRow("Auth token", config.auth_token),
            statusRow("Phone number", config.phone_number),
            statusRow("Public webhook URL", config.public_base_url)
          ),
          h("button", { class: "button primary full", on: { click: openConnectionSettings } }, "Configure connection", icon("settings", 16))
        ),
        h("section", { class: "settings-card" },
          h("div", { class: "settings-card-head" }, h("div", { class: "settings-icon" }, icon("external")), h("div", {}, h("h2", {}, "Twilio Console"), h("p", {}, "Manage numbers, messaging webhooks, and usage."))),
          h("button", { class: "button secondary full", on: { click: () => window.desktop?.openExternal?.("https://console.twilio.com/") } }, "Open Twilio Console", icon("external", 16))
        ),
        h("section", { class: "settings-card span-two" },
          h("div", { class: "settings-card-head" }, h("div", { class: "settings-icon" }, h("span", { class: "status-dot online" })), h("div", {}, h("h2", {}, "Local service"), h("p", {}, "Connected and storing app data locally in SQLite."))),
          h("div", { class: "service-address" }, h("code", {}, HOST), h("span", {}, state.desktopStatus?.running === false ? "Stopped" : "Online")),
          h("button", { class: "button secondary full", on: { click: async () => {
            if (state.desktopStatus?.running === false) {
              state.desktopStatus = await window.desktop.startServer({});
              HOST = state.desktopStatus.baseUrl;
              state.config = await API.config();
            } else {
              state.desktopStatus = await window.desktop.stopServer();
            }
            render();
          } } }, state.desktopStatus?.running === false ? "Start local service" : "Stop local service")
        )
      )
    );
  }

  function renderError() {
    if (!state.error) return null;
    return h("div", { class: "toast error", role: "alert" }, icon("alert", 18), h("span", {}, state.error), h("button", { "aria-label": "Dismiss error", on: { click: () => { state.error = ""; render(); } } }, icon("close", 16)));
  }

  function render() {
    root.replaceChildren(
      h("div", { class: "app-shell" },
        renderRail(),
        state.view === "messages" ? renderConversationList() : null,
        state.view === "messages" ? renderChat() : state.view === "contacts" ? renderContacts() : renderSettings(),
        renderError()
      )
    );
  }

  async function poll() {
    const previous = new Map(state.threads.map((thread) => [thread.id, thread.unread_count || 0]));
    try {
      await loadThreads();
      state.threads.forEach((thread) => {
        if ((thread.unread_count || 0) > (previous.get(thread.id) || 0)) notify("New message", displayName(thread));
      });
      if (state.selectedThread) {
        state.messages = await API.messages(state.selectedThread) || [];
        state.oldestTs = state.messages[0]?.ts || null;
      }
      render();
    } catch (_) {
      render();
    }
  }

  async function boot() {
    state.desktopStatus = await window.desktop?.getStatus?.() || null;
    HOST = state.desktopStatus?.baseUrl || await window.desktop?.backendUrl?.() || HOST;
    window.desktop?.onServerStatus?.((status) => {
      state.desktopStatus = status;
      HOST = status.baseUrl || HOST;
      render();
    });
    try {
      const [threads, contacts, config] = await Promise.all([API.threads(), API.contacts(), API.config()]);
      state.threads = threads || [];
      state.contacts = contacts || [];
      state.config = config;
    } catch (error) {
      state.error = `The local service is unavailable. ${error.message}`;
    } finally {
      state.loading = false;
      render();
      state.polling = setInterval(poll, 5000);
    }
  }

  boot();
})();
