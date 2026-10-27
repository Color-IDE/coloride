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
打开一个文件夹，在这台电脑上编辑代码、使用终端和浏览器。这些操作不会调用 Coloride 服务器。

Coloride 是商标。MIT 许可证覆盖源代码，不覆盖名称、标志和域名。

## 现在可用的功能

Coloride 运行在 **Apple Silicon 的 macOS** 上。

- **编辑代码：**文件树、标签页、CodeMirror 语言支持、补全、诊断、搜索和图片预览。
- **运行项目：**带作业控制的本地终端。本地宿主进程还在时，会话会保留。
- **查看结果：**内置 Chromium 浏览器和独立窗口。localhost 指向这台电脑。
- **从空白文件开始：**New File 打开一个未命名缓冲区。有改动时，关闭会询问是否保存。

登录和托管智能体是关闭的。`coloride.dev` 还没有 API。SSH 代码仍在仓库里，不会出现在界面上。[路线图](./docs/roadmap.md)记录的是优先级，不是已完成的功能。

## 检查

完成下面的准备后，在仓库根目录运行：

```sh
corepack pnpm typecheck
core/ide-host/.venv/bin/python -m pytest core/ide-host/tests -q
```

界面测试见 [tests/README.md](./tests/README.md)。如何提交改动见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 开发与文档

环境配置、命令和贡献规则统一维护在以下指南中，避免各语言版本出现不一致。

- [Coloride README](README.md)
- [架构](README.md#architecture)
- [开始开发](README.md#start-developing)
- [贡献](CONTRIBUTING.md)
- [测试](tests/README.md)
- [安全](SECURITY.md)
- [MIT 许可证](LICENSE)
