<div align="center">

# Coloride

**Dein Code. Dein Mac. Eine IDE.**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/Hergestellt%20in-Europa-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="Hergestellt in Europa" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/Lizenz-MIT-555555?style=flat-square" alt="MIT-Lizenz" /></a>


[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · **Deutsch** · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride: Editor und Terminal" width="880" />

</div>

---
Öffne einen Ordner und arbeite auf diesem Computer mit Code, Terminal und Browser. Nichts davon ruft einen Coloride-Server auf.

Coloride ist eine Marke. Die MIT-Lizenz gilt für den Quelltext, nicht für Name, Logo oder Domains.

## Was heute funktioniert

Coloride läuft auf **macOS mit Apple Silicon**.

- **Code bearbeiten:** Explorer, Tabs, CodeMirror-Sprachen, Vervollständigung, Diagnosen, Suche und Bildvorschau.
- **Das Projekt ausführen:** lokale Terminals mit Jobsteuerung. Die Sitzung bleibt, solange der lokale Host läuft.
- **Das Ergebnis sehen:** eingebetteter Chromium-Browser und eigene Fenster. Localhost zeigt auf deinen Computer.
- **Mit einer leeren Datei starten:** New File öffnet einen unbenannten Puffer. Beim Schließen fragt er, ob Änderungen gespeichert werden sollen.

Anmeldung und verwalteter Agent sind aus. `coloride.dev` hat noch keine API. SSH-Code liegt noch im Repository und erscheint nicht in der Oberfläche. Die [Roadmap](./docs/roadmap.md) nennt Prioritäten, keine fertige Arbeit.

## Prüfungen

Im Repository-Root, nach der Einrichtung unten:

```sh
corepack pnpm typecheck
core/ide-host/.venv/bin/python -m pytest core/ide-host/tests -q
```

Oberflächentests stehen in [tests/README.md](./tests/README.md). Änderungen sendest du nach [CONTRIBUTING.md](./CONTRIBUTING.md).

## Entwicklung und Dokumentation

Einrichtung, Befehle und Beitragsregeln stehen in den verlinkten Anleitungen, damit die Übersetzungen nicht auseinanderlaufen.

- [Coloride README](README.md)
- [Architektur](README.md#architecture)
- [Mit der Entwicklung beginnen](README.md#start-developing)
- [Beitragen](CONTRIBUTING.md)
- [Tests](tests/README.md)
- [Sicherheit](SECURITY.md)
- [MIT-Lizenz](LICENSE)
