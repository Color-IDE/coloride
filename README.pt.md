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
Abra uma pasta e trabalhe com código, terminal e navegador neste computador. Nada disso chama um servidor Coloride.

Coloride é uma marca. A licença MIT cobre o código, não o nome, o logo nem os domínios.

## O que funciona hoje

O Coloride roda no **macOS com Apple Silicon**.

- **Editar código:** explorador, abas, linguagens do CodeMirror, preenchimento, diagnósticos, busca e prévia de imagens.
- **Executar o projeto:** terminais locais com controle de tarefas. A sessão continua enquanto o host local estiver ativo.
- **Ver o resultado:** navegador Chromium integrado e janelas separadas. Localhost aponta para o seu computador.
- **Começar com um arquivo em branco:** New File abre um buffer sem título. Se você alterar, ao fechar ele pergunta se deve salvar.

O login e o agente gerenciado estão desligados. `coloride.dev` ainda não tem API. O código de SSH continua no repositório e não aparece na interface. O [roteiro](./docs/roadmap.md) marca prioridades, não trabalho pronto.

## Verificações

Na raiz do repositório, depois da preparação abaixo:

```sh
corepack pnpm typecheck
core/ide-host/.venv/bin/python -m pytest core/ide-host/tests -q
```

Os testes de interface estão em [tests/README.md](./tests/README.md). Como enviar uma mudança está em [CONTRIBUTING.md](./CONTRIBUTING.md).

## Desenvolvimento e documentação

A configuração, os comandos e as regras de contribuição ficam centralizados nos guias abaixo para evitar divergências entre traduções.

- [Coloride README](README.md)
- [Arquitetura](README.md#architecture)
- [Começar a desenvolver](README.md#start-developing)
- [Contribuir](CONTRIBUTING.md)
- [Testes](tests/README.md)
- [Segurança](SECURITY.md)
- [Licença MIT](LICENSE)
