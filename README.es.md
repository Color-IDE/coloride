<div align="center">

# Coloride

**Tu código. Tu Mac. Un solo IDE.**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/Hecho%20en-Europa-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="Hecho en Europa" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/licencia-MIT-555555?style=flat-square" alt="Licencia MIT" /></a>


[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Español** · [Français](README.fr.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride: editor y terminal" width="880" />

</div>

---

Coloride es un IDE local para macOS con Apple Silicon. Incluye editor, explorador de archivos, terminales locales y navegador integrado. Puedes trabajar sin cuenta; los servicios de nube vienen desactivados.

## Inicio rápido

Necesitas Node.js 22, pnpm 9.15.4 y Python 3.12.

```sh
python3.12 -m venv core/ide-host/.venv
core/ide-host/.venv/bin/python -m pip install -e 'core/ide-host[dev]'
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Consulta el [README en inglés](README.md) para la arquitectura y el estado actual, [CONTRIBUTING.md](CONTRIBUTING.md) para contribuir y [SECURITY.md](SECURITY.md) para informar de vulnerabilidades.
