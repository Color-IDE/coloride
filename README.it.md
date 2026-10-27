<div align="center">

# Coloride

**Il tuo codice. Il tuo Mac. Un solo IDE.**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/Fatto%20in-Europa-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="Fatto in Europa" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/licenza-MIT-555555?style=flat-square" alt="Licenza MIT" /></a>


[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · **Italiano**

<img src="docs/assets/coloride-ide.png" alt="Coloride: editor, terminale e agente" width="880" />

</div>

---

Apri una cartella e lavora con codice, terminali, browser e agente nella stessa applicazione. Modificare file locali e usare il terminale non richiede un account Coloride, una connessione SSH o un VPS. Le funzioni di IA richiedono un fornitore configurato o un account per i modelli gestiti.

Coloride supporta attualmente **macOS su Apple Silicon**. I workspace SSH sono facoltativi; l'IDE locale è il prodotto principale. Le richieste ai modelli e le integrazioni attive possono inviare il contesto selezionato ai servizi configurati.

## Cosa puoi fare

- **Modificare il codice:** esploratore di file, più schede, supporto linguaggi con CodeMirror, completamento, diagnostica, ricerca e anteprima delle immagini.
- **Eseguire il progetto:** terminali locali con controllo dei processi, riconnessione e sessioni persistenti finché l'host locale resta attivo.
- **Vedere il risultato:** browser Chromium integrato e finestre separate. In locale, localhost punta al tuo Mac; via SSH, il browser usa il tunnel SOCKS remoto.
- **Lavorare con un agente:** contesto del progetto, scelta del modello, strumenti, approvazioni, risposte in streaming e revisione dei file con Keep / Undo.
- **Personalizzare lo spazio di lavoro:** aspetto, scorciatoie da tastiera, terminali divisi e appunti di sistema.
- **Collegarti in remoto quando serve:** workspace SSH/SFTP e informazioni sul server, senza rendere un server necessario per lo sviluppo locale.

## Sviluppo e documentazione

Preparazione, comandi e regole di contributo restano nelle guide collegate, così le traduzioni non divergono.

- [Coloride README](README.md)
- [Architettura](README.md#architecture)
- [Iniziare a sviluppare](README.md#start-developing)
- [Contribuire](CONTRIBUTING.md)
- [Test](tests/README.md)
- [Sicurezza](SECURITY.md)
- [Licenza MIT](LICENSE)
