# Arbeitsregeln für KI-Agenten

## Ziel
Dieses Repository ist gleichzeitig die Weboberfläche und die zentrale, versionierte Datenbasis einer Gruppenarbeit.

## Vor jeder inhaltlichen Änderung
1. `PROJECT.md` lesen.
2. `manifest.yaml` lesen.
3. `workspace/aufgaben/tasks.yaml` prüfen.
4. Bestehende Originaldateien nicht ungefragt verändern.

## Inhaltsstruktur
- Neue, unsortierte Dateien: `workspace/00_eingang/`
- Aufgabenstellung: `workspace/01_aufgabenstellung/`
- Originalquellen: `workspace/02_quellen/originale/`
- KI-extrahierte Texte: `workspace/02_quellen/extrahiert/`
- Laufende Arbeit: `workspace/03_arbeitsstand/`
- Präsentation: `workspace/04_praesentation/`
- Abgabefertige Dateien: `workspace/05_endabgabe/`
- Entscheidungen: `workspace/entscheidungen/`

## Regeln
- Originaldateien nie überschreiben; stattdessen eine neue Version oder Ableitung anlegen.
- Textbasierte Formate wie Markdown, YAML und CSV bevorzugen.
- Zu wichtigen Binärdateien eine kurze `.md`-Beschreibung oder extrahierte Textfassung anlegen.
- Größere Änderungen auf einem eigenen Branch durchführen.
- Keine Geheimnisse, Tokens oder Zugangsdaten committen.
