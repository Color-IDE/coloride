<div align="center">

# Coloride

**コードも、Mac も。ひとつの IDE で。**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/%E6%AC%A7%E5%B7%9E%E8%A3%BD-Europe-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="欧州製" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-555555?style=flat-square" alt="MIT license" /></a>


[English](README.md) · [中文](README.zh-CN.md) · **日本語** · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride のエディタとターミナル" width="880" />

</div>

---

Coloride は Apple Silicon 搭載の macOS 向けローカル IDE です。エディター、ファイルエクスプローラー、ターミナル、内蔵ブラウザーを備えています。アカウントは不要で、クラウド機能は初期設定で無効です。

## クイックスタート

Node.js 22、pnpm 9.15.4、Python 3.12 が必要です。

```sh
python3.12 -m venv core/ide-host/.venv
core/ide-host/.venv/bin/python -m pip install -e 'core/ide-host[dev]'
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

詳細は [英語版 README](README.md)、[貢献ガイド](CONTRIBUTING.md)、[セキュリティ方針](SECURITY.md)をご覧ください。
