<div align="center">

# Coloride

**Il tuo codice. Il tuo Mac. Un solo IDE.**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/Fatto%20in-Europa-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="Fatto in Europa" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/licenza-MIT-555555?style=flat-square" alt="Licenza MIT" /></a>


[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · **Italiano**

<img src="docs/assets/coloride-ide.png" alt="Coloride: editor e terminale" width="880" />

</div>

---
Apri una cartella e lavora con codice, terminale e browser su questo computer. Niente di questo chiama un server Coloride.

Coloride è un marchio. La licenza MIT copre il codice, non il nome, il logo o i domini.

## Cosa funziona oggi

Coloride gira su **macOS con Apple Silicon**.

- **Modificare il codice:** esplora file, schede, linguaggi CodeMirror, completamento, diagnostica, ricerca e anteprima immagini.
- **Eseguire il progetto:** terminali locali con controllo dei processi. La sessione resta finché l'host locale è attivo.
- **Vedere il risultato:** browser Chromium integrato e finestre separate. Localhost punta al tuo computer.
- **Iniziare da un file vuoto:** New File apre un buffer senza titolo. Se lo modifichi, alla chiusura chiede se salvarlo.

Accesso e agente gestito sono spenti. `coloride.dev` non ha ancora un'API. Il codice SSH resta nel repository e non compare nell'interfaccia. La [roadmap](./docs/roadmap.md) indica priorità, non lavoro finito.

## Controlli

Dalla radice del repository, dopo la preparazione sotto:

```sh
corepack pnpm typecheck
core/ide-host/.venv/bin/python -m pytest core/ide-host/tests -q
```

I test di interfaccia sono in [tests/README.md](./tests/README.md). Come inviare una modifica è in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Sviluppo e documentazione

Preparazione, comandi e regole di contributo restano nelle guide collegate, così le traduzioni non divergono.

- [Coloride README](README.md)
- [Architettura](README.md#architecture)
- [Iniziare a sviluppare](README.md#start-developing)
- [Contribuire](CONTRIBUTING.md)
- [Test](tests/README.md)
- [Sicurezza](SECURITY.md)
- [Licenza MIT](LICENSE)
