import "./styles.css";

const config = {
  apiBase: "",
  repository: "",
  branch: "main",
  rootPath: "workspace",
  maxUploadMb: 20,
  ...(window.GROUPHUB_CONFIG || {}),
};

const SESSION_KEY = "grouphub_session";
const TEXT_EXTENSIONS = new Set([
  "md", "txt", "csv", "tsv", "json", "yaml", "yml", "xml", "html", "css",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "java", "sql", "tex", "toml",
  "ini", "cfg", "log", "svg"
]);

const state = {
  session: sessionStorage.getItem(SESSION_KEY),
  user: null,
  path: "",
  items: [],
  search: "",
  loading: false,
  editing: null,
};

const app = document.querySelector("#app");

function assertConfigured() {
  if (!config.apiBase || config.apiBase.includes("DEIN-WORKER")) {
    throw new Error("Die API-Adresse ist noch nicht in public/config.js eingetragen.");
  }
}

function apiUrl(path) {
  return `${config.apiBase.replace(/\/$/, "")}${path}`;
}

async function apiFetch(path, options = {}) {
  assertConfigured();
  const headers = new Headers(options.headers || {});
  if (state.session) headers.set("Authorization", `Bearer ${state.session}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(apiUrl(path), { ...options, headers });
  if (response.status === 401) {
    logout(false);
    throw new Error("Deine Sitzung ist abgelaufen. Bitte erneut anmelden.");
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof payload === "object" ? payload.error || payload.message : payload;
    const error = new Error(message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function parseSessionFromHash() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const session = hash.get("session");
  const authError = hash.get("auth_error");
  if (session) {
    sessionStorage.setItem(SESSION_KEY, session);
    state.session = session;
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (authError) {
    history.replaceState(null, "", location.pathname + location.search);
    toast(decodeURIComponent(authError), true);
  }
}

function login() {
  try {
    assertConfigured();
    const returnUrl = `${location.origin}${location.pathname}`;
    location.href = apiUrl(`/auth/login?return_url=${encodeURIComponent(returnUrl)}`);
  } catch (error) {
    toast(error.message, true);
  }
}

function logout(showMessage = true) {
  sessionStorage.removeItem(SESSION_KEY);
  state.session = null;
  state.user = null;
  state.items = [];
  state.path = "";
  render();
  if (showMessage) toast("Abgemeldet.");
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes = 0) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function extension(name) {
  const part = name.split(".").pop();
  return part === name ? "" : part.toLowerCase();
}

function isTextFile(name) {
  return TEXT_EXTENSIONS.has(extension(name));
}

function iconFor(item) {
  if (item.type === "dir") return "📁";
  const ext = extension(item.name);
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼️";
  if (["pdf"].includes(ext)) return "📕";
  if (["doc", "docx", "odt"].includes(ext)) return "📘";
  if (["xls", "xlsx", "ods", "csv"].includes(ext)) return "📊";
  if (["ppt", "pptx", "odp"].includes(ext)) return "📙";
  if (["zip", "7z", "rar"].includes(ext)) return "🗜️";
  return "📄";
}

function relativePath(fullPath) {
  const prefix = `${config.rootPath.replace(/^\/+|\/+$/g, "")}/`;
  return fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
}

function joinPath(...parts) {
  return parts.filter(Boolean).join("/").replace(/\/{2,}/g, "/");
}

function parentPath(path) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function renderLogin(error = "") {
  app.innerHTML = `
    <div class="login-wrap">
      <section class="login-card">
        <div class="logo">G</div>
        <h1>GroupHub</h1>
        <p>Die einfache Dateiablage für eure Gruppenarbeit. Änderungen werden automatisch versioniert und bleiben für Codex, Claude und andere Git-Tools lesbar.</p>
        ${error ? `<div class="notice error">${escapeHtml(error)}</div>` : ""}
        <button id="loginButton" class="btn primary">Mit GitHub anmelden</button>
        <p class="meta">Zugriff erhalten nur GitHub-Nutzer, die für <code>${escapeHtml(config.repository)}</code> freigeschaltet sind.</p>
      </section>
      <div class="toast-container" id="toasts"></div>
    </div>`;
  document.querySelector("#loginButton").addEventListener("click", login);
}

function render() {
  if (!state.session) {
    const configError = (!config.apiBase || config.apiBase.includes("DEIN-WORKER"))
      ? "Vor dem ersten Einsatz muss einmalig die Worker-Adresse eingetragen werden."
      : "";
    renderLogin(configError);
    return;
  }

  const pathParts = state.path.split("/").filter(Boolean);
  const breadcrumbs = [
    `<button class="crumb" data-path="">Dateien</button>`,
    ...pathParts.map((part, index) => {
      const path = pathParts.slice(0, index + 1).join("/");
      return `<span class="meta">/</span><button class="crumb" data-path="${escapeHtml(path)}">${escapeHtml(part)}</button>`;
    })
  ].join("");

  const filtered = state.items.filter(item => item.name.toLowerCase().includes(state.search.toLowerCase()));
  const rows = filtered.map(item => {
    const rel = relativePath(item.path);
    const primaryAction = item.type === "dir" ? "open-folder" : isTextFile(item.name) ? "edit-file" : "download-file";
    return `
      <div class="row" data-path="${escapeHtml(rel)}">
        <div class="file-main">
          <span class="file-icon">${iconFor(item)}</span>
          <button class="file-name" data-action="${primaryAction}" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</button>
        </div>
        <span class="meta size">${item.type === "dir" ? "Ordner" : formatBytes(item.size)}</span>
        <span class="meta type">${item.type === "dir" ? "Ordner" : (extension(item.name).toUpperCase() || "Datei")}</span>
        <div class="row-actions">
          ${item.type === "file" ? `<button class="btn ghost small" data-action="download-file" title="Herunterladen">↓</button>` : ""}
          ${item.type === "file" ? `<button class="btn danger small" data-action="delete-file" data-sha="${escapeHtml(item.sha)}" title="Löschen">×</button>` : ""}
        </div>
      </div>`;
  }).join("");

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand"><div class="logo">G</div><span>GroupHub</span></div>
        <div class="user">
          ${state.user?.avatarUrl ? `<img class="avatar" src="${escapeHtml(state.user.avatarUrl)}" alt="" />` : ""}
          <span class="name">${escapeHtml(state.user?.login || "")}</span>
          <button id="logoutButton" class="btn ghost small">Abmelden</button>
        </div>
      </header>
      <main>
        <section class="hero">
          <div><h1>Gemeinsame Dateien</h1><p>${escapeHtml(config.repository)} · ${escapeHtml(config.branch)}</p></div>
          <div class="actions">
            <button id="newTextButton" class="btn">＋ Neue Textdatei</button>
            <button id="uploadButton" class="btn primary">↑ Dateien hochladen</button>
            <input id="fileInput" type="file" multiple hidden />
          </div>
        </section>
        <section class="panel">
          <div class="toolbar">
            <nav class="breadcrumb">${breadcrumbs}</nav>
            <input id="searchInput" class="search" type="search" placeholder="Dateien filtern …" value="${escapeHtml(state.search)}" />
          </div>
          <div class="file-list">
            ${state.loading ? `<div class="loading">Dateien werden geladen …</div>` : rows || `<div class="empty">Dieser Ordner ist leer.</div>`}
          </div>
        </section>
        <div class="notice">Tipp: Zieht Dateien einfach in dieses Fenster. Text-, Markdown-, CSV- und Code-Dateien können direkt im Browser bearbeitet werden.</div>
      </main>
      <div class="dropzone" id="dropzone"><div class="dropbox">Dateien hier ablegen</div></div>
      ${editorDialogHtml()}
      <div class="toast-container" id="toasts"></div>
    </div>`;

  bindEvents();
}

function editorDialogHtml() {
  return `
    <dialog id="editorDialog">
      <form method="dialog">
        <div class="modal-head"><h2 class="modal-title">Textdatei bearbeiten</h2><button class="btn ghost small" value="cancel">Schließen</button></div>
      </form>
      <div class="modal-body">
        <input id="editorFilename" class="filename" aria-label="Dateiname" />
        <textarea id="editorContent" class="editor" spellcheck="false"></textarea>
      </div>
      <div class="modal-foot">
        <button id="cancelEditor" class="btn ghost">Abbrechen</button>
        <button id="saveEditor" class="btn primary">Speichern</button>
      </div>
    </dialog>`;
}

function bindEvents() {
  document.querySelector("#logoutButton")?.addEventListener("click", () => logout());
  document.querySelector("#uploadButton")?.addEventListener("click", () => document.querySelector("#fileInput").click());
  document.querySelector("#fileInput")?.addEventListener("change", event => uploadFiles([...event.target.files]));
  document.querySelector("#newTextButton")?.addEventListener("click", () => openEditor({ isNew: true }));
  document.querySelector("#searchInput")?.addEventListener("input", event => { state.search = event.target.value; render(); });
  document.querySelectorAll(".crumb").forEach(button => button.addEventListener("click", () => loadDirectory(button.dataset.path)));

  document.querySelectorAll(".row").forEach(row => {
    row.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", event => {
      event.stopPropagation();
      const action = button.dataset.action;
      const path = row.dataset.path;
      if (action === "open-folder") loadDirectory(path);
      if (action === "edit-file") openEditor({ path });
      if (action === "download-file") downloadFile(path);
      if (action === "delete-file") deleteFile(path, button.dataset.sha);
    }));
  });

  const dialog = document.querySelector("#editorDialog");
  document.querySelector("#cancelEditor")?.addEventListener("click", () => dialog.close());
  document.querySelector("#saveEditor")?.addEventListener("click", saveEditor);

  const dropzone = document.querySelector("#dropzone");
  let dragDepth = 0;
  window.addEventListener("dragenter", event => { event.preventDefault(); dragDepth += 1; dropzone.classList.add("active"); });
  window.addEventListener("dragover", event => event.preventDefault());
  window.addEventListener("dragleave", event => { event.preventDefault(); dragDepth -= 1; if (dragDepth <= 0) dropzone.classList.remove("active"); });
  window.addEventListener("drop", event => {
    event.preventDefault(); dragDepth = 0; dropzone.classList.remove("active");
    uploadFiles([...event.dataTransfer.files]);
  });
}

async function initialize() {
  parseSessionFromHash();
  if (!state.session) return render();
  render();
  try {
    state.user = await apiFetch("/api/me");
    await loadDirectory("");
  } catch (error) {
    renderLogin(error.message);
  }
}

async function loadDirectory(path) {
  state.path = path || "";
  state.search = "";
  state.loading = true;
  render();
  try {
    const query = new URLSearchParams({ path: state.path });
    const result = await apiFetch(`/api/list?${query}`);
    state.items = result.items.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, "de", { numeric: true });
    });
  } catch (error) {
    state.items = [];
    toast(error.message, true);
  } finally {
    state.loading = false;
    render();
  }
}

async function openEditor({ path = "", isNew = false }) {
  const dialog = document.querySelector("#editorDialog");
  const nameInput = document.querySelector("#editorFilename");
  const contentInput = document.querySelector("#editorContent");
  state.editing = { path, sha: null, isNew };

  if (isNew) {
    nameInput.value = "neue-notiz.md";
    nameInput.disabled = false;
    contentInput.value = "# Neue Notiz\n\n";
    dialog.showModal();
    nameInput.select();
    return;
  }

  nameInput.value = path.split("/").pop();
  nameInput.disabled = true;
  contentInput.value = "Wird geladen …";
  dialog.showModal();
  try {
    const query = new URLSearchParams({ path });
    const file = await apiFetch(`/api/file?${query}`);
    state.editing.sha = file.sha;
    contentInput.value = decodeBase64Utf8(file.contentBase64);
  } catch (error) {
    dialog.close();
    toast(error.message, true);
  }
}

async function saveEditor() {
  const dialog = document.querySelector("#editorDialog");
  const name = document.querySelector("#editorFilename").value.trim();
  const content = document.querySelector("#editorContent").value;
  if (!name || name.includes("/") || name.includes("\\")) return toast("Bitte einen gültigen Dateinamen ohne Schrägstriche eingeben.", true);

  const path = state.editing.isNew ? joinPath(state.path, name) : state.editing.path;
  try {
    await apiFetch("/api/file", {
      method: "PUT",
      body: JSON.stringify({
        path,
        contentBase64: encodeUtf8Base64(content),
        sha: state.editing.sha || state.items.find(item => item.type === "file" && item.name === name)?.sha || undefined,
        message: `${state.editing.isNew ? "Erstellt" : "Bearbeitet"}: ${path}`,
      }),
    });
    dialog.close();
    toast("Datei gespeichert.");
    await loadDirectory(state.path);
  } catch (error) {
    if (error.status === 409) toast("Die Datei wurde zwischenzeitlich geändert. Bitte neu laden und erneut bearbeiten.", true);
    else toast(error.message, true);
  }
}

async function uploadFiles(files) {
  if (!files.length) return;
  const maxBytes = config.maxUploadMb * 1024 * 1024;
  for (const file of files) {
    if (file.size > maxBytes) {
      toast(`${file.name} ist größer als ${config.maxUploadMb} MB.`, true);
      continue;
    }
    try {
      const buffer = await file.arrayBuffer();
      await apiFetch("/api/file", {
        method: "PUT",
        body: JSON.stringify({
          path: joinPath(state.path, file.name),
          contentBase64: arrayBufferToBase64(buffer),
          sha: state.items.find(item => item.type === "file" && item.name === file.name)?.sha || undefined,
          message: `Hochgeladen: ${joinPath(state.path, file.name)}`,
        }),
      });
      toast(`${file.name} hochgeladen.`);
    } catch (error) {
      toast(`${file.name}: ${error.message}`, true);
    }
  }
  await loadDirectory(state.path);
}

async function downloadFile(path) {
  try {
    const query = new URLSearchParams({ path });
    const file = await apiFetch(`/api/file?${query}`);
    const bytes = base64ToUint8Array(file.contentBase64);
    const blob = new Blob([bytes], { type: file.mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = path.split("/").pop();
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    toast(error.message, true);
  }
}

async function deleteFile(path, sha) {
  if (!confirm(`„${path.split("/").pop()}“ wirklich löschen? Die Datei bleibt über den Git-Verlauf wiederherstellbar.`)) return;
  try {
    await apiFetch("/api/file", {
      method: "DELETE",
      body: JSON.stringify({ path, sha, message: `Gelöscht: ${path}` }),
    });
    toast("Datei gelöscht.");
    await loadDirectory(state.path);
  } catch (error) {
    toast(error.message, true);
  }
}

function encodeUtf8Base64(text) {
  return arrayBufferToBase64(new TextEncoder().encode(text));
}

function decodeBase64Utf8(base64) {
  return new TextDecoder().decode(base64ToUint8Array(base64));
}

function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toast(message, isError = false) {
  let container = document.querySelector("#toasts");
  if (!container) {
    container = document.createElement("div");
    container.id = "toasts";
    container.className = "toast-container";
    document.body.append(container);
  }
  const element = document.createElement("div");
  element.className = `toast${isError ? " error" : ""}`;
  element.textContent = message;
  container.append(element);
  setTimeout(() => element.remove(), 5000);
}

initialize();
