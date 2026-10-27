<div align="center">

# Coloride

**Votre code. Votre Mac. Un seul IDE.**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/Fabriqu%C3%A9%20en-Europe-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="Fabriqué en Europe" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/licence-MIT-555555?style=flat-square" alt="Licence MIT" /></a>


[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · **Français** · [Português](README.pt.md) · [Deutsch](README.de.md) · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride : éditeur, terminal et agent" width="880" />

</div>

---



Ouvrez un dossier et retrouvez votre code, vos terminaux, votre navigateur et votre agent dans une seule application. Modifier des fichiers locaux et utiliser le terminal ne nécessite ni compte Coloride, ni connexion SSH, ni VPS. Les fonctions d’IA nécessitent un fournisseur configuré ou un compte pour les modèles gérés.

Coloride prend actuellement en charge **macOS sur Apple Silicon**. Les espaces de travail SSH sont facultatifs ; l’IDE local reste le cœur du produit. Les requêtes aux modèles et les intégrations activées peuvent transmettre le contexte sélectionné aux services configurés.

## Fonctionnalités

- **Modifier du code :** explorateur de fichiers, onglets multiples, prise en charge des langages avec CodeMirror, complétion, diagnostics, recherche et aperçu des images.
- **Exécuter un projet :** terminaux locaux avec contrôle des tâches, reconnexion et sessions persistantes tant que l’hôte local reste actif.
- **Prévisualiser votre travail :** navigateur Chromium intégré et fenêtres séparées. En local, localhost désigne votre Mac ; en SSH, le navigateur utilise le tunnel SOCKS distant.
- **Travailler avec un agent :** contexte du projet, choix du modèle, outils, approbations, réponses en streaming et revue des fichiers avec Keep / Undo.
- **Personnaliser l’espace de travail :** apparence, raccourcis clavier, terminaux divisés et intégration du presse-papiers.
- **Se connecter à distance si nécessaire :** espaces de travail SSH/SFTP et informations serveur, sans imposer un serveur au développement local.

## Développement et documentation

La configuration, les commandes et les règles de contribution sont centralisées dans les guides ci-dessous pour éviter les divergences entre traductions.

- [Coloride README](README.md)
- [Architecture](README.md#architecture)
- [Commencer à développer](README.md#start-developing)
- [Contribuer](CONTRIBUTING.md)
- [Tests](tests/README.md)
- [Sécurité](SECURITY.md)
- [Licence MIT](LICENSE)
