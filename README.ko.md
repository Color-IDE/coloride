<div align="center">

# Coloride

**내 코드, 내 Mac. 하나의 IDE.**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/%EC%9C%A0%EB%9F%BD%EC%A0%9C%EC%A1%B0-Europe-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="유럽 제조" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-555555?style=flat-square" alt="MIT license" /></a>


[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · **한국어** · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride 편집기, 터미널, 에이전트" width="880" />

</div>

---



폴더를 열고 코드, 터미널, 브라우저, 코딩 에이전트를 하나의 앱에서 사용하세요. 로컬 파일 편집과 터미널 사용에는 Coloride 계정, SSH 연결 또는 VPS가 필요하지 않습니다. AI 기능에는 설정된 모델 제공업체 또는 관리형 모델 계정이 필요합니다.

Coloride는 현재 **Apple Silicon Mac의 macOS**를 지원합니다. SSH 워크스페이스는 선택 기능이며, 로컬 IDE가 제품의 중심입니다. 모델 요청과 활성화된 연동 기능은 선택된 컨텍스트를 설정된 서비스로 전송할 수 있습니다.

## 주요 기능

- **코드 편집:** 파일 탐색기, 여러 탭, CodeMirror 언어 지원, 자동 완성, 진단, 검색 및 이미지 미리 보기.
- **프로젝트 실행:** 작업 제어, 재연결, 로컬 호스트가 실행되는 동안 유지되는 세션을 갖춘 내장 터미널.
- **작업 미리 보기:** 내장 Chromium 브라우저와 별도 창. 로컬 워크스페이스의 localhost는 내 Mac을 가리키며, SSH에서는 원격 SOCKS 터널을 사용합니다.
- **에이전트와 작업:** 프로젝트 컨텍스트, 모델 선택, 도구, 승인, 스트리밍 응답, Keep / Undo를 통한 파일 변경 검토.
- **워크스페이스 사용자화:** 외관, 키보드 단축키, 분할 터미널 및 클립보드 연동.
- **필요할 때 원격 연결:** SSH/SFTP 워크스페이스와 서버 정보. 로컬 개발에 서버는 필요하지 않습니다.

## 개발 및 문서

설정, 명령어 및 기여 규칙은 번역 간 불일치를 방지하기 위해 아래 가이드에서 관리합니다.

- [Coloride README](README.md)
- [아키텍처](README.md#architecture)
- [개발 시작](README.md#start-developing)
- [기여](CONTRIBUTING.md)
- [테스트](tests/README.md)
- [보안](SECURITY.md)
- [MIT 라이선스](LICENSE)
