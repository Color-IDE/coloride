<div align="center">

# Coloride

**Votre code. Votre Mac. Un seul IDE.**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/Fabriqu%C3%A9%20en-Europe-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="Fabriqué en Europe" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/licence-MIT-555555?style=flat-square" alt="Licence MIT" /></a>


[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · **Français** · [Português](README.pt.md) · [Deutsch](README.de.md) · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride : éditeur et terminal" width="880" />

</div>

---
Ouvrez un dossier et travaillez avec votre code, le terminal et le navigateur sur cet ordinateur. Rien de cela n'appelle un serveur Coloride.

Coloride est une marque. La licence MIT couvre le code source, pas le nom, le logo ni les domaines.

## Ce qui fonctionne aujourd'hui

Coloride tourne sur **macOS avec Apple Silicon**.

- **Modifier le code :** explorateur, onglets, langages CodeMirror, complétion, diagnostics, recherche et aperçu des images.
- **Lancer le projet :** terminaux locaux avec contrôle des tâches. La session reste ouverte tant que l'hôte local tourne.
- **Voir le résultat :** navigateur Chromium intégré et fenêtres séparées. Localhost pointe vers votre ordinateur.
- **Commencer par un fichier vide :** New File ouvre un buffer sans titre. S'il a changé, sa fermeture demande s'il faut l'enregistrer.

La connexion et l'agent géré sont désactivés. `coloride.dev` n'a pas encore d'API. Le code SSH reste dans le dépôt et n'apparaît pas dans l'interface. La [feuille de route](./docs/roadmap.md) indique des priorités, pas un travail terminé.

## Vérifications

Depuis la racine du dépôt, après la préparation ci-dessous :

```sh
corepack pnpm typecheck
core/ide-host/.venv/bin/python -m pytest core/ide-host/tests -q
```

Les tests d'interface sont dans [tests/README.md](./tests/README.md). Envoyer un changement se fait selon [CONTRIBUTING.md](./CONTRIBUTING.md).

## Développement et documentation

La configuration, les commandes et les règles de contribution sont centralisées dans les guides ci-dessous pour éviter les divergences entre traductions.

- [Coloride README](README.md)
- [Architecture](README.md#architecture)
- [Commencer à développer](README.md#start-developing)
- [Contribuer](CONTRIBUTING.md)
- [Tests](tests/README.md)
- [Sécurité](SECURITY.md)
- [Licence MIT](LICENSE)
