<div align="center">

# Coloride

**Votre code. Votre Mac. Un seul IDE.**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/Fabriqu%C3%A9%20en-Europe-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="Fabriqué en Europe" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/licence-MIT-555555?style=flat-square" alt="Licence MIT" /></a>


[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · **Français** · [Português](README.pt.md) · [Deutsch](README.de.md) · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride : éditeur et terminal" width="880" />

</div>

---

Coloride est un IDE local pour macOS avec Apple Silicon : éditeur, explorateur de fichiers, terminaux et navigateur intégré. Aucun compte n’est nécessaire ; les services cloud sont désactivés par défaut.

## Démarrage rapide

Installez Node.js 22, pnpm 9.15.4 et Python 3.12.

```sh
python3.12 -m venv core/ide-host/.venv
core/ide-host/.venv/bin/python -m pip install -e 'core/ide-host[dev]'
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Consultez le [README anglais](README.md), le [guide de contribution](CONTRIBUTING.md) et la [politique de sécurité](SECURITY.md).
