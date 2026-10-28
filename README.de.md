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

Coloride ist eine lokale IDE für macOS mit Apple Silicon, mit Editor, Dateiexplorer, Terminals und integriertem Browser. Ein Konto ist nicht erforderlich. Cloud-Dienste sind standardmäßig deaktiviert.

## Schnellstart

Voraussetzungen: Node.js 22, pnpm 9.15.4 und Python 3.12.

```sh
python3.12 -m venv core/ide-host/.venv
core/ide-host/.venv/bin/python -m pip install -e 'core/ide-host[dev]'
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Weitere Informationen: [Englisches README](README.md), [Beiträge](CONTRIBUTING.md), [Sicherheit](SECURITY.md).
