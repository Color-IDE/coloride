<div align="center">

# Coloride

**내 코드, 내 Mac. 하나의 IDE.**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/%EC%9C%A0%EB%9F%BD%EC%A0%9C%EC%A1%B0-Europe-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="유럽 제조" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-555555?style=flat-square" alt="MIT license" /></a>


[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · **한국어** · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride 편집기와 터미널" width="880" />

</div>

---

Coloride는 Apple Silicon Mac용 로컬 IDE입니다. 편집기, 파일 탐색기, 터미널, 내장 브라우저를 제공합니다. 계정 없이 사용할 수 있으며 클라우드 서비스는 기본적으로 비활성화되어 있습니다.

## 빠른 시작

Node.js 22, pnpm 9.15.4, Python 3.12가 필요합니다.

```sh
python3.12 -m venv core/ide-host/.venv
core/ide-host/.venv/bin/python -m pip install -e 'core/ide-host[dev]'
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

자세한 내용은 [영문 README](README.md), [기여 안내](CONTRIBUTING.md), [보안 정책](SECURITY.md)을 참고하세요.
