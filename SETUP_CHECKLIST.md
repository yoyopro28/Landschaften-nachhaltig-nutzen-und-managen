# Einrichtungs-Checkliste

## 1. GitHub-Repository

Das Repository `yoyopro28/Landschaften-nachhaltig-nutzen-und-managen` wurde angelegt und mit dem GroupHub-MVP befüllt.

Empfehlung: Das Repository zunächst **privat** anlegen. Beachte, dass GitHub Pages bei privaten Repositories vom gebuchten GitHub-Tarif abhängen kann. Alternativ kann nur der Web-App-Code öffentlich und die Arbeitsdateiablage in einem getrennten privaten Repository liegen; der Worker unterstützt diese Trennung nach einer kleinen Konfigurationsanpassung.

## 2. GitHub OAuth App

Unter GitHub:

1. **Settings → Developer settings → OAuth Apps → New OAuth App** öffnen.
2. Application name: `GroupHub`.
3. Homepage URL: spätere GitHub-Pages-Adresse, z. B. `https://yoyopro28.github.io/Landschaften-nachhaltig-nutzen-und-managen/`.
4. Authorization callback URL: `https://DEIN-WORKER.workers.dev/auth/callback`.
5. App registrieren.
6. `Client ID` und einen neu erzeugten `Client secret` bereithalten.

Die App fordert den Scope `repo` an. Der Worker ist trotzdem technisch auf das eine konfigurierte Repository und den Ordner `workspace/` begrenzt.

## 3. Cloudflare Worker

```bash
cd worker
npm install
npx wrangler login
cp wrangler.toml.example wrangler.toml
```

Passe in `wrangler.toml` an:

```toml
GITHUB_REPOSITORY = "yoyopro28/Landschaften-nachhaltig-nutzen-und-managen"
ALLOWED_ORIGINS = "http://localhost:5173,https://DEIN-NAME.github.io"
```

Secrets setzen:

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

Für `SESSION_SECRET` eine lange zufällige Zeichenfolge verwenden, beispielsweise erzeugt mit:

```bash
openssl rand -base64 48
```

Worker deployen:

```bash
npm run deploy
```

Die ausgegebene Adresse notieren, beispielsweise `https://grouphub-api.DEIN-SUBDOMAIN.workers.dev`.

## 4. Frontend konfigurieren

In `public/config.js` eintragen:

```js
window.GROUPHUB_CONFIG = {
  apiBase: "https://grouphub-api.DEIN-SUBDOMAIN.workers.dev",
  repository: "yoyopro28/Landschaften-nachhaltig-nutzen-und-managen",
  branch: "main",
  rootPath: "workspace",
  maxUploadMb: 20
};
```

Danach committen und pushen.

## 5. GitHub Pages aktivieren

Im Repository:

1. **Settings → Pages** öffnen.
2. Unter **Build and deployment** als Source **GitHub Actions** wählen.
3. Den Workflow `Deploy GroupHub to GitHub Pages` starten oder einen Commit pushen.
4. Die veröffentlichte URL öffnen.

Änderungen ausschließlich unter `workspace/` lösen bewusst kein erneutes Pages-Deployment aus.

## 6. Gruppenmitglieder freischalten

Unter **Settings → Collaborators** die GitHub-Nutzernamen der Gruppenmitglieder mit Schreibrecht hinzufügen. Beim ersten Öffnen melden sie sich nur über den Button **Mit GitHub anmelden** an. Git-Befehle müssen sie nicht verwenden.

## 7. Funktionstest

1. Mit einem freigeschalteten Konto anmelden.
2. Eine Datei nach `00_eingang` hochladen.
3. Eine Markdown-Datei erstellen und speichern.
4. Im GitHub-Repository prüfen, ob passende Commits entstanden sind.
5. Repository mit Codex oder Claude Code klonen und `AGENTS.md` beziehungsweise `CLAUDE.md` lesen lassen.
