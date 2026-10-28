<div align="center">

# Coloride

**你的代码。你的 Mac。一个 IDE。**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/%E6%AC%A7%E6%B4%B2%E5%88%B6%E9%80%A0-Europe-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="欧洲制造" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-555555?style=flat-square" alt="MIT license" /></a>


[English](README.md) · **中文** · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride 编辑器与终端" width="880" />

</div>

---

Coloride 是适用于 Apple Silicon Mac 的本地 IDE，包含编辑器、文件资源管理器、终端和内置浏览器。无需账号即可使用，云服务默认关闭。

## 快速开始

需要 Node.js 22、pnpm 9.15.4 和 Python 3.12。

```sh
python3.12 -m venv core/ide-host/.venv
core/ide-host/.venv/bin/python -m pip install -e 'core/ide-host[dev]'
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

详情请参阅[英文 README](README.md)、[贡献指南](CONTRIBUTING.md)和[安全政策](SECURITY.md)。
