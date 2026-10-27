<div align="center">

# Coloride

**你的代码。你的 Mac。一个 IDE。**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/%E6%AC%A7%E6%B4%B2%E5%88%B6%E9%80%A0-Europe-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="欧洲制造" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-555555?style=flat-square" alt="MIT license" /></a>


[English](README.md) · **中文** · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride 编辑器、终端和代理" width="880" />

</div>

---



打开一个文件夹，即可在同一个应用中使用代码编辑器、终端、浏览器和编程智能体。编辑本地文件和使用终端不需要 Coloride 账户、SSH 连接或 VPS。AI 功能需要配置模型服务商，或使用托管模型账户。

Coloride 目前支持 **Apple Silicon Mac 上的 macOS**。SSH 工作区是可选功能，本地 IDE 是产品核心。模型请求及已启用的集成可能会将选定的上下文发送至所配置的服务。

## 功能

- **编辑代码：**文件资源管理器、多标签页、CodeMirror 语言支持、自动补全、诊断、搜索和图片预览。
- **运行项目：**内置本地终端，支持作业控制、重新连接，以及在本地主机进程存活期间保留会话。
- **预览成果：**内置 Chromium 浏览器，并可弹出为独立窗口。在本地工作区中，localhost 指向你的 Mac；在 SSH 工作区中，浏览器使用远程 SOCKS 隧道。
- **使用编程智能体：**项目上下文、模型选择、工具调用、操作审批、流式回复，以及通过 Keep / Undo 审查文件变更。
- **自定义工作区：**外观、键盘快捷键、分屏终端和系统剪贴板集成。
- **按需远程连接：**SSH/SFTP 工作区和服务器信息；本地开发不依赖远程服务器。

## 开发与文档

环境配置、命令和贡献规则统一维护在以下指南中，避免各语言版本出现不一致。

- [Coloride README](README.md)
- [架构](README.md#architecture)
- [开始开发](README.md#start-developing)
- [贡献](CONTRIBUTING.md)
- [测试](tests/README.md)
- [安全](SECURITY.md)
- [MIT 许可证](LICENSE)
