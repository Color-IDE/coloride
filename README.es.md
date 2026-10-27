<div align="center">

# Coloride

**Tu código. Tu Mac. Un solo IDE.**

<img src="https://img.shields.io/badge/macOS-Apple%20Silicon-151515?style=flat-square&logo=apple&logoColor=white" alt="macOS · Apple Silicon" />
<img src="https://img.shields.io/badge/Hecho%20en-Europa-003399?style=flat-square&labelColor=003399&logo=europeanunion&logoColor=FFCC00" alt="Hecho en Europa" />
<a href="./LICENSE"><img src="https://img.shields.io/badge/licencia-MIT-555555?style=flat-square" alt="Licencia MIT" /></a>


[English](README.md) · [中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Español** · [Français](README.fr.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [Italiano](README.it.md)

<img src="docs/assets/coloride-ide.png" alt="Coloride: editor, terminal y agente" width="880" />

</div>

---



Abre una carpeta y trabaja con tu código, terminales, navegador y agente en la misma aplicación. Editar archivos locales y usar el terminal no requiere una cuenta de Coloride, una conexión SSH ni un VPS. Las funciones de IA necesitan un proveedor configurado o una cuenta para modelos gestionados.

Coloride admite actualmente **macOS con Apple Silicon**. Los workspaces SSH son opcionales; el IDE local es el núcleo del producto. Las solicitudes a modelos y las integraciones activadas pueden enviar el contexto seleccionado a los servicios configurados.

## Qué puedes hacer

- **Editar código:** explorador de archivos, varias pestañas, soporte de lenguajes con CodeMirror, autocompletado, diagnósticos, búsqueda y vista previa de imágenes.
- **Ejecutar tu proyecto:** terminales locales con control de procesos, reconexión y sesiones persistentes mientras el host local siga activo.
- **Previsualizar tu trabajo:** navegador Chromium integrado y ventanas independientes. En local, localhost apunta a tu Mac; por SSH, el navegador utiliza el túnel SOCKS remoto.
- **Trabajar con un agente:** contexto del proyecto, selección de modelo, herramientas, aprobaciones, respuestas en streaming y revisión de archivos con Keep / Undo.
- **Personalizar el espacio de trabajo:** apariencia, atajos de teclado, terminales divididos e integración con el portapapeles.
- **Conectarte en remoto cuando lo necesites:** workspaces SSH/SFTP e información del servidor, sin exigir un servidor para desarrollar en local.

## Desarrollo y documentación

La preparación del entorno, los comandos y las reglas de contribución se mantienen en las guías enlazadas para evitar instrucciones divergentes entre traducciones.

- [Coloride README](README.md)
- [Arquitectura](README.md#architecture)
- [Empezar a desarrollar](README.md#start-developing)
- [Contribuir](CONTRIBUTING.md)
- [Pruebas](tests/README.md)
- [Seguridad](SECURITY.md)
- [Licencia MIT](LICENSE)
