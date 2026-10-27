<div align="center">

# Coloride

**Il tuo codice. Il tuo Mac. Un solo IDE.**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/Fatto%20in-Europa-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="Fatto in Europa" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/licenza-MIT-555555?style=flat-square" alt="Licenza MIT" /></a>


[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · **Italiano**

<img src="docs/assets/coloride-ide.png" alt="Coloride: editor e terminale" width="880" />

</div>

---

Coloride è un IDE locale per macOS con Apple Silicon, con editor, esplora file, terminali e browser integrato. Non serve un account; i servizi cloud sono disattivati per impostazione predefinita.

## Avvio rapido

Requisiti: Node.js 22, pnpm 9.15.4 e Python 3.12.

```sh
python3.12 -m venv core/ide-host/.venv
core/ide-host/.venv/bin/python -m pip install -e 'core/ide-host[dev]'
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Consulta il [README inglese](README.md), la [guida ai contributi](CONTRIBUTING.md) e la [politica di sicurezza](SECURITY.md).
