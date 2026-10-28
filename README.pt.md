<div align="center">

# Coloride

**Seu código. Seu Mac. Um só IDE.**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/Feito%20na-Europa-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="Feito na Europa" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/licen%C3%A7a-MIT-555555?style=flat-square" alt="Licença MIT" /></a>


[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · **Português** · [Deutsch](README.de.md) · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride: editor e terminal" width="880" />

</div>

---

Coloride é um IDE local para macOS com Apple Silicon, com editor, explorador de arquivos, terminais e navegador integrado. Não exige conta; os serviços de nuvem estão desativados por padrão.

## Início rápido

Requisitos: Node.js 22, pnpm 9.15.4 e Python 3.12.

```sh
python3.12 -m venv core/ide-host/.venv
core/ide-host/.venv/bin/python -m pip install -e 'core/ide-host[dev]'
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Consulte o [README em inglês](README.md), o [guia de contribuição](CONTRIBUTING.md) e a [política de segurança](SECURITY.md).
