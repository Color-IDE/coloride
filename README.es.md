<div align="center">

# Coloride

**Tu código. Tu Mac. Un solo IDE.**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/Hecho%20en-Europa-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="Hecho en Europa" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/licencia-MIT-555555?style=flat-square" alt="Licencia MIT" /></a>


[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Español** · [Français](README.fr.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride: editor y terminal" width="880" />

</div>

---
Abre una carpeta y trabaja con tu código, la terminal y el navegador en este ordenador. Nada de eso llama a un servidor de Coloride.

Coloride es una marca. La licencia MIT cubre el código, no el nombre, el logo ni los dominios.

## Qué funciona hoy

Coloride funciona en **macOS con Apple Silicon**.

- **Editar código:** explorador, pestañas, lenguajes de CodeMirror, autocompletado, diagnósticos, búsqueda y vista previa de imágenes.
- **Ejecutar el proyecto:** terminales locales con control de procesos. La sesión sigue mientras el host local esté vivo.
- **Ver el resultado:** navegador Chromium integrado y ventanas aparte. Localhost apunta a tu ordenador.
- **Empezar con un archivo en blanco:** New File abre un buffer sin título. Si lo cambias y lo cierras, pregunta si guardarlo.

El inicio de sesión y el agente gestionado están apagados. `coloride.dev` todavía no tiene API. El código de SSH sigue en el repositorio y no aparece en la interfaz. La [hoja de ruta](./docs/roadmap.md) marca prioridades, no trabajo terminado.

## Comprobaciones

Desde la raíz del repositorio, después de la preparación de abajo:

```sh
corepack pnpm typecheck
core/ide-host/.venv/bin/python -m pytest core/ide-host/tests -q
```

Las pruebas de interfaz están en [tests/README.md](./tests/README.md). Cómo enviar un cambio está en [CONTRIBUTING.md](./CONTRIBUTING.md).

## Desarrollo y documentación

La preparación del entorno, los comandos y las reglas de contribución se mantienen en las guías enlazadas para evitar instrucciones divergentes entre traducciones.

- [Coloride README](README.md)
- [Arquitectura](README.md#architecture)
- [Empezar a desarrollar](README.md#start-developing)
- [Contribuir](CONTRIBUTING.md)
- [Pruebas](tests/README.md)
- [Seguridad](SECURITY.md)
- [Licencia MIT](LICENSE)
