# GroupHub

Eine einfache GitHub-basierte Dateiablage für Gruppenarbeiten. Nicht-technische Gruppenmitglieder sehen nur eine übersichtliche Weboberfläche; GitHub, Codex, Claude Code und andere Git-Werkzeuge arbeiten auf derselben versionierten Datenbasis.

## Funktionen

- GitHub-Anmeldung
- Ordneransicht und Breadcrumb-Navigation
- Drag-and-drop-Upload bis zur konfigurierten Größenbegrenzung
- Direkte Bearbeitung von Markdown, Text, CSV, YAML, JSON und Code
- Download und Löschen von Dateien
- Automatische Git-Commits für jede Änderung
- Zugriffsschutz: Nur Repository-Mitglieder mit Schreibrecht
- GitHub-Pages-Deployment für das Frontend
- Cloudflare Worker als sicherer OAuth- und GitHub-API-Proxy

## Architektur

```text
Browser auf GitHub Pages
        │ verschlüsselte Sitzung
        ▼
Cloudflare Worker
        │ GitHub OAuth / REST API
        ▼
GitHub-Repository /workspace
        ▲
Codex, Claude Code, Git
```

Das OAuth-Token wird nie im Frontend oder Repository gespeichert. Der Worker gibt dem Browser nur ein zeitlich begrenztes, verschlüsseltes Sitzungstoken.

## Lokal starten

```bash
npm install
npm run dev
```

Ohne konfigurierten Worker zeigt die Oberfläche bewusst einen Einrichtungshinweis. Der Produktions-Build lässt sich trotzdem testen:

```bash
npm run check
npm run build
npm run preview
```

## Einmalige Einrichtung

Die genaue Reihenfolge steht in [`SETUP_CHECKLIST.md`](SETUP_CHECKLIST.md).

Kurzfassung:

1. Dieses Repository enthält bereits den vollständigen Projektstand.
2. GitHub OAuth App anlegen.
3. Cloudflare Worker konfigurieren und deployen.
4. Worker-URL in `public/config.js` eintragen.
5. GitHub Pages unter **Settings → Pages** auf **GitHub Actions** stellen.
6. Gruppenmitglieder als Repository-Collaborators mit Schreibrecht hinzufügen.

## Aktueller Sichtbarkeitshinweis

Dieses Repository ist derzeit **öffentlich**. Solange Arbeitsdateien im selben Repository unter `workspace/` gespeichert werden, sind sie ebenfalls öffentlich sichtbar. Vor dem Hochladen vertraulicher oder personenbezogener Unterlagen sollte entweder die Repository-Sichtbarkeit geändert oder ein getrenntes privates Daten-Repository verwendet werden.

## Sicherheitsmodell

- Der GitHub-Client-Secret liegt ausschließlich als Cloudflare-Secret vor.
- Der Worker akzeptiert nur freigegebene Frontend-Ursprünge.
- Der Worker ist fest auf genau ein Repository und den Ordner `workspace/` begrenzt.
- Pfade mit `..`, Backslashes oder Nullbytes werden abgewiesen.
- Schreibkonflikte werden nicht still überschrieben.
- Browser-Sitzungen laufen standardmäßig nach zwölf Stunden ab.

## Grenzen des MVP

- Keine gleichzeitige Live-Bearbeitung wie in Google Docs.
- Keine Vorschau für Office- oder CAD-Dateien.
- Kein Upload leerer Ordner, da Git keine leeren Ordner kennt.
- Große CAD-, Video- und Rohdaten sollten später in Objektspeicher ausgelagert werden.
