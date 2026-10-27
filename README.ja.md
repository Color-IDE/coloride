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
フォルダーを開いて、このコンピューター上でコード、ターミナル、ブラウザーを使います。この操作は Coloride のサーバーを呼びません。

Coloride は商標です。MIT ライセンスが対象にするのはソースコードであり、名称、ロゴ、ドメインではありません。

## 今動くもの

Coloride は **Apple Silicon の macOS** で動きます。

- **コードを編集する:** エクスプローラー、タブ、CodeMirror の言語、補完、診断、検索、画像プレビュー。
- **プロジェクトを実行する:** ジョブ制御つきのローカルターミナル。ローカルホストが動いている間、セッションは残ります。
- **結果を見る:** 内蔵 Chromium ブラウザーと別ウィンドウ。localhost はこのコンピューターを指します。
- **空のファイルから始める:** New File は無題のバッファを開きます。変更して閉じると、保存するかを尋ねます。

サインインとマネージドエージェントはオフです。`coloride.dev` にはまだ API がありません。SSH のコードはリポジトリに残っていますが、画面には出ません。[ロードマップ](./docs/roadmap.md) は優先順位であり、完成した機能ではありません。

## 確認

下の準備のあと、リポジトリのルートで実行します。

```sh
corepack pnpm typecheck
core/ide-host/.venv/bin/python -m pytest core/ide-host/tests -q
```

画面のテストは [tests/README.md](./tests/README.md)、変更の送り方は [CONTRIBUTING.md](./CONTRIBUTING.md) にあります。

## 開発とドキュメント

セットアップ、コマンド、貢献ルールは、翻訳間の不一致を避けるため、以下のガイドに集約しています。

- [Coloride README](README.md)
- [アーキテクチャ](README.md#architecture)
- [開発を始める](README.md#start-developing)
- [コントリビュート](CONTRIBUTING.md)
- [テスト](tests/README.md)
- [セキュリティ](SECURITY.md)
- [MIT ライセンス](LICENSE)
