const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const cors = corsHeaders(request, env);

      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (url.pathname === "/health") return json({ ok: true, service: "grouphub-api" }, 200, cors);
      if (url.pathname === "/auth/login") return startLogin(url, env);
      if (url.pathname === "/auth/callback") return finishLogin(url, env);

      if (!url.pathname.startsWith("/api/")) return json({ error: "Nicht gefunden." }, 404, cors);
      const session = await requireSession(request, env);

      if (url.pathname === "/api/me" && request.method === "GET") return apiMe(session, env, cors);
      if (url.pathname === "/api/list" && request.method === "GET") return apiList(url, session, env, cors);
      if (url.pathname === "/api/file" && request.method === "GET") return apiGetFile(url, session, env, cors);
      if (url.pathname === "/api/file" && request.method === "PUT") return apiPutFile(request, session, env, cors);
      if (url.pathname === "/api/file" && request.method === "DELETE") return apiDeleteFile(request, session, env, cors);

      return json({ error: "Nicht gefunden." }, 404, cors);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      return json({ error: status === 500 ? "Interner Serverfehler." : error.message }, status, corsHeaders(request, env));
    }
  },
};

async function startLogin(url, env) {
  requireEnv(env, ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "SESSION_SECRET", "GITHUB_REPOSITORY"]);
  const returnUrl = url.searchParams.get("return_url");
  assertAllowedReturnUrl(returnUrl, env);
  const state = await signState({ returnUrl, exp: Date.now() + 10 * 60 * 1000, nonce: crypto.randomUUID() }, env.SESSION_SECRET);
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
  authorize.searchParams.set("scope", "repo");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("allow_signup", "true");
  return Response.redirect(authorize.toString(), 302);
}

async function finishLogin(url, env) {
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  if (!code || !stateToken) return authFailure("Anmeldung wurde abgebrochen.", allowedFallbackOrigin(env));

  let state;
  try {
    state = await verifyState(stateToken, env.SESSION_SECRET);
    assertAllowedReturnUrl(state.returnUrl, env);
  } catch {
    return authFailure("Ungültige oder abgelaufene Anmeldung.", allowedFallbackOrigin(env));
  }

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json", "User-Agent": "GroupHub" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${url.origin}/auth/callback`,
      }),
    });
    const tokenPayload = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload.error_description || "GitHub-Anmeldung fehlgeschlagen.");

    const user = await githubFetch("/user", tokenPayload.access_token);
    const permission = await githubFetch(`/repos/${env.GITHUB_REPOSITORY}/collaborators/${encodeURIComponent(user.login)}/permission`, tokenPayload.access_token);
    if (!permission.user?.permissions?.push && !["admin", "maintain", "write"].includes(permission.permission)) {
      throw statusError(403, "Dein GitHub-Konto hat keinen Schreibzugriff auf dieses Projekt.");
    }

    const hours = Math.max(1, Math.min(Number(env.SESSION_HOURS || 12), 72));
    const session = await encryptSession({
      githubToken: tokenPayload.access_token,
      login: user.login,
      avatarUrl: user.avatar_url,
      repository: env.GITHUB_REPOSITORY,
      exp: Date.now() + hours * 60 * 60 * 1000,
    }, env.SESSION_SECRET);

    const target = new URL(state.returnUrl);
    target.hash = `session=${encodeURIComponent(session)}`;
    return Response.redirect(target.toString(), 302);
  } catch (error) {
    return authFailure(error.message || "Anmeldung fehlgeschlagen.", state.returnUrl);
  }
}

function authFailure(message, returnUrl) {
  const target = new URL(returnUrl);
  target.hash = `auth_error=${encodeURIComponent(message)}`;
  return Response.redirect(target.toString(), 302);
}

async function apiMe(session, env, cors) {
  const user = await githubFetch("/user", session.githubToken);
  return json({ login: user.login, name: user.name, avatarUrl: user.avatar_url, repository: env.GITHUB_REPOSITORY }, 200, cors);
}

async function apiList(url, session, env, cors) {
  const relative = sanitizeRelativePath(url.searchParams.get("path") || "");
  const actual = projectPath(relative, env);
  const branch = encodeURIComponent(env.GITHUB_BRANCH || "main");
  const data = await githubFetch(`/repos/${env.GITHUB_REPOSITORY}/contents/${encodePath(actual)}?ref=${branch}`, session.githubToken);
  if (!Array.isArray(data)) throw statusError(400, "Der angeforderte Pfad ist kein Ordner.");
  return json({
    path: relative,
    items: data.map(item => ({ name: item.name, path: item.path, type: item.type, size: item.size, sha: item.sha })),
  }, 200, cors);
}

async function apiGetFile(url, session, env, cors) {
  const relative = sanitizeRelativePath(url.searchParams.get("path") || "");
  if (!relative) throw statusError(400, "Dateipfad fehlt.");
  const actual = projectPath(relative, env);
  const branch = encodeURIComponent(env.GITHUB_BRANCH || "main");
  const data = await githubFetch(`/repos/${env.GITHUB_REPOSITORY}/contents/${encodePath(actual)}?ref=${branch}`, session.githubToken);
  if (data.type !== "file") throw statusError(400, "Der Pfad ist keine Datei.");

  let contentBase64 = (data.content || "").replace(/\s/g, "");
  if (!contentBase64 || data.encoding !== "base64") {
    const blob = await githubFetch(`/repos/${env.GITHUB_REPOSITORY}/git/blobs/${data.sha}`, session.githubToken);
    contentBase64 = (blob.content || "").replace(/\s/g, "");
  }

  return json({
    name: data.name,
    path: relative,
    sha: data.sha,
    size: data.size,
    contentBase64,
    mimeType: guessMimeType(data.name),
  }, 200, cors);
}

async function apiPutFile(request, session, env, cors) {
  const body = await readJson(request);
  const relative = sanitizeRelativePath(body.path || "");
  if (!relative) throw statusError(400, "Dateipfad fehlt.");
  validateBase64(body.contentBase64);
  enforceUploadLimit(body.contentBase64, env);

  const payload = {
    message: cleanCommitMessage(body.message || `Datei aktualisiert: ${relative}`),
    content: body.contentBase64.replace(/\s/g, ""),
    branch: env.GITHUB_BRANCH || "main",
  };
  if (body.sha) payload.sha = body.sha;

  const result = await githubFetch(`/repos/${env.GITHUB_REPOSITORY}/contents/${encodePath(projectPath(relative, env))}`, session.githubToken, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return json({ ok: true, sha: result.content?.sha, commit: result.commit?.sha }, 200, cors);
}

async function apiDeleteFile(request, session, env, cors) {
  const body = await readJson(request);
  const relative = sanitizeRelativePath(body.path || "");
  if (!relative || !body.sha) throw statusError(400, "Dateipfad oder SHA fehlt.");
  const result = await githubFetch(`/repos/${env.GITHUB_REPOSITORY}/contents/${encodePath(projectPath(relative, env))}`, session.githubToken, {
    method: "DELETE",
    body: JSON.stringify({
      message: cleanCommitMessage(body.message || `Datei gelöscht: ${relative}`),
      sha: body.sha,
      branch: env.GITHUB_BRANCH || "main",
    }),
  });
  return json({ ok: true, commit: result.commit?.sha }, 200, cors);
}

async function githubFetch(path, token, options = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "GroupHub",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status === 422 && /sha|does not match/i.test(data.message || "") ? 409 : response.status;
    throw statusError(status, githubErrorMessage(status, data.message));
  }
  return data;
}

function githubErrorMessage(status, fallback = "GitHub-Anfrage fehlgeschlagen.") {
  if (status === 401) return "GitHub-Anmeldung ist nicht mehr gültig.";
  if (status === 403) return "Für diese Aktion fehlt die GitHub-Berechtigung.";
  if (status === 404) return "Datei oder Ordner wurde nicht gefunden.";
  if (status === 409) return "Die Datei wurde zwischenzeitlich geändert.";
  if (status === 422) return "Die Datei konnte nicht gespeichert werden. Möglicherweise existiert sie bereits.";
  return fallback;
}

async function requireSession(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw statusError(401, "Nicht angemeldet.");
  const session = await decryptSession(authorization.slice(7), env.SESSION_SECRET).catch(() => null);
  if (!session || session.exp < Date.now() || session.repository !== env.GITHUB_REPOSITORY) throw statusError(401, "Sitzung abgelaufen.");
  return session;
}

function sanitizeRelativePath(input) {
  const decoded = String(input || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!decoded) return "";
  const parts = decoded.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || part.includes("\0"))) throw statusError(400, "Ungültiger Dateipfad.");
  return parts.join("/");
}

function projectPath(relative, env) {
  const root = sanitizeRelativePath(env.ROOT_PATH || "workspace");
  return relative ? `${root}/${relative}` : root;
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function validateBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.replace(/\s/g, ""))) throw statusError(400, "Dateiinhalt ist nicht gültig kodiert.");
}

function enforceUploadLimit(base64, env) {
  const maxMb = Math.max(1, Math.min(Number(env.MAX_UPLOAD_MB || 20), 80));
  const bytes = Math.ceil(base64.replace(/\s/g, "").length * 3 / 4);
  if (bytes > maxMb * 1024 * 1024) throw statusError(413, `Dateien dürfen höchstens ${maxMb} MB groß sein.`);
}

function cleanCommitMessage(message) {
  return String(message).replace(/[\r\n]+/g, " ").trim().slice(0, 120) || "GroupHub-Dateiänderung";
}

function guessMimeType(name) {
  const ext = name.split(".").pop()?.toLowerCase();
  return ({
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    svg: "image/svg+xml", json: "application/json", csv: "text/csv", md: "text/markdown", txt: "text/plain", html: "text/html",
    css: "text/css", js: "text/javascript", xml: "application/xml", zip: "application/zip",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  })[ext] || "application/octet-stream";
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = allowedOrigins(env);
  const headers = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
  if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "").split(",").map(item => item.trim().replace(/\/$/, "")).filter(Boolean);
}

function allowedFallbackOrigin(env) {
  const origin = allowedOrigins(env)[0];
  return origin || "http://localhost:5173";
}

function assertAllowedReturnUrl(returnUrl, env) {
  if (!returnUrl) throw statusError(400, "Rücksprungadresse fehlt.");
  const url = new URL(returnUrl);
  const allowed = allowedOrigins(env);
  if (!allowed.includes(url.origin)) throw statusError(400, "Rücksprungadresse ist nicht freigegeben.");
  if (!/^https?:$/.test(url.protocol)) throw statusError(400, "Ungültige Rücksprungadresse.");
}

function requireEnv(env, names) {
  const missing = names.filter(name => !env[name]);
  if (missing.length) throw new Error(`Worker-Konfiguration fehlt: ${missing.join(", ")}`);
}

async function readJson(request) {
  try { return await request.json(); }
  catch { throw statusError(400, "Ungültige JSON-Anfrage."); }
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

function statusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function signState(payload, secret) {
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(body, secret);
  return `${body}.${base64UrlEncode(signature)}`;
}

async function verifyState(token, secret) {
  const [body, signature] = token.split(".");
  if (!body || !signature) throw new Error("invalid state");
  const expected = await hmac(body, secret);
  if (!timingSafeEqual(expected, base64UrlDecode(signature))) throw new Error("invalid signature");
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
  if (!payload.exp || payload.exp < Date.now()) throw new Error("expired state");
  return payload;
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function encryptSession(payload, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await sessionKey(secret, ["encrypt"]);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  return `${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`;
}

async function decryptSession(token, secret) {
  const [ivPart, ciphertextPart] = token.split(".");
  if (!ivPart || !ciphertextPart) throw new Error("invalid session");
  const key = await sessionKey(secret, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlDecode(ivPart) }, key, base64UrlDecode(ciphertextPart));
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function sessionKey(secret, usages) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, usages);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
