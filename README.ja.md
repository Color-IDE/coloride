<div align="center">

# Coloride

**コードも、Mac も。ひとつの IDE で。**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/%E6%AC%A7%E5%B7%9E%E8%A3%BD-Europe-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="欧州製" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-555555?style=flat-square" alt="MIT license" /></a>


[English](README.md) · [中文](README.zh-CN.md) · **日本語** · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride のエディタ、ターミナル、エージェント" width="880" />

</div>

---



フォルダーを開くだけで、コード、ターミナル、ブラウザー、コーディングエージェントをひとつのアプリで利用できます。ローカルファイルの編集やターミナルの利用に、Coloride アカウント、SSH 接続、VPS は必要ありません。AI 機能には、設定済みのモデルプロバイダー、またはマネージドモデル用のアカウントが必要です。

Coloride は現在、**Apple Silicon 搭載 Mac の macOS** に対応しています。SSH ワークスペースは任意の機能であり、ローカル IDE が製品の中心です。モデルへのリクエストや有効な連携機能では、選択したコンテキストが設定先のサービスに送信されることがあります。

## できること

- **コード編集：**ファイルエクスプローラー、複数タブ、CodeMirror の言語サポート、補完、診断、検索、画像プレビュー。
- **プロジェクトの実行：**ジョブ制御、再接続、ローカルホストが稼働している間のセッション保持に対応した内蔵ターミナル。
- **作業のプレビュー：**内蔵 Chromium ブラウザーと独立ウィンドウ。ローカルでは localhost は自分の Mac を指し、SSH ではリモートの SOCKS トンネルを使用します。
- **エージェントとの作業：**プロジェクトのコンテキスト、モデル選択、ツール、承認、ストリーミング応答、Keep / Undo によるファイル変更のレビュー。
- **ワークスペースの調整：**外観、キーボードショートカット、ターミナル分割、クリップボード連携。
- **必要に応じたリモート接続：**SSH/SFTP ワークスペースとサーバー情報。ローカル開発にサーバーは不要です。

## 開発とドキュメント

セットアップ、コマンド、貢献ルールは、翻訳間の不一致を避けるため、以下のガイドに集約しています。

- [Coloride README](README.md)
- [アーキテクチャ](README.md#architecture)
- [開発を始める](README.md#start-developing)
- [コントリビュート](CONTRIBUTING.md)
- [テスト](tests/README.md)
- [セキュリティ](SECURITY.md)
- [MIT ライセンス](LICENSE)
