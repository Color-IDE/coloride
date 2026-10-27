<div align="center">

# Coloride

**Dein Code. Dein Mac. Eine IDE.**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/Hergestellt%20in-Europa-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="Hergestellt in Europa" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/Lizenz-MIT-555555?style=flat-square" alt="MIT-Lizenz" /></a>


[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · **Deutsch** · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride: Editor, Terminal und Agent" width="880" />

</div>

---

Öffne einen Ordner und arbeite mit Code, Terminals, Browser und Agent in derselben Anwendung. Lokale Dateien und das Terminal brauchen kein Coloride-Konto, keine SSH-Verbindung und keinen VPS. KI-Funktionen brauchen einen konfigurierten Modellanbieter oder ein Konto für verwaltete Modelle.

Coloride unterstützt derzeit **macOS auf Apple Silicon**. SSH-Workspaces sind optional; die lokale IDE ist das Kernprodukt. Modellanfragen und aktivierte Integrationen können den ausgewählten Kontext an die konfigurierten Dienste senden.

## Was du tun kannst

- **Code bearbeiten:** Dateiexplorer, mehrere Editor-Tabs, CodeMirror-Sprachunterstützung, Vervollständigung, Diagnosen, Suche und Bildvorschau.
- **Dein Projekt ausführen:** lokale Terminals mit Jobsteuerung, Wiederverbindung und dauerhaften Sitzungen, solange der lokale Host läuft.
- **Deine Arbeit ansehen:** eingebetteter Chromium-Browser und eigene Fenster. Lokal zeigt localhost auf deinen Mac; über SSH nutzt der Browser den entfernten SOCKS-Tunnel.
- **Mit einem Agent arbeiten:** Projektkontext, Modellauswahl, Werkzeuge, Freigaben, gestreamte Antworten und Dateireview mit Keep / Undo.
- **Den Workspace anpassen:** Erscheinungsbild, Tastenkürzel, geteilte Terminals und die native Zwischenablage.
- **Bei Bedarf remote verbinden:** SSH/SFTP-Workspaces und Serverinformationen, ohne einen Server zur Voraussetzung für lokale Entwicklung zu machen.

## Entwicklung und Dokumentation

Einrichtung, Befehle und Beitragsregeln stehen in den verlinkten Anleitungen, damit die Übersetzungen nicht auseinanderlaufen.

- [Coloride README](README.md)
- [Architektur](README.md#architecture)
- [Mit der Entwicklung beginnen](README.md#start-developing)
- [Beitragen](CONTRIBUTING.md)
- [Tests](tests/README.md)
- [Sicherheit](SECURITY.md)
- [MIT-Lizenz](LICENSE)
