# Local work and recovery

Opening a folder, editing, search, and local terminals do not call a Coloride
server. A model provider is a separate choice: it uses the key you save and
that provider's own network.

## Without a network

These keep working on a local folder:

- File tree, editor, save, and local search
- Local terminals already started by the Python host
- Language tools that are installed on this Mac
- The embedded browser for a page on this computer

These stop, or never start, without a network:

- Any configured model provider (OpenAI, Gemini, xAI, DeepSeek, Mistral, Groq, and a remote custom endpoint)
- Checking for an update
- A remote workspace. SSH is still in the source and is not exposed in the interface

Ollama is the exception among providers. It talks to `127.0.0.1:11434`. It
needs the local Ollama process, not an internet connection. If that process is
not running, the provider row says so. It does not fall back to another host.

A network drop does not close a local terminal. The shell is a process on this
Mac. A page loaded from the internet in the embedded browser fails like any
other browser tab.

## After a crash

Save writes the file to disk. A crash after that write keeps the file.

Text you have typed and not saved lives in the editor process. Coloride does
not write a hot-exit copy of that buffer. Quit, force-quit, or a crash drops
it. Closing a dirty tab still asks before discard; a crash does not get that
prompt.

What does come back:

- The last local folder, which sidebars were open, and which terminal panel was open. That snapshot is `coloride.session.last.v1` in local storage.
- Files that were already saved.
- Agent checkpoints, under `~/.coloride/desktop/agent-checkpoints/`. A checkpoint is the file state the agent recorded before a change. It is not a copy of the unsaved editor.
- A terminal scrollback file, if the Python host was still running. The host is left alive on purpose while terminal tabs are open, so a window reload can reconnect to the same shell. Killing the host, or a reboot, ends those processes.

Composer text is also only in memory. It is kept while you switch panels. It
is gone after the window process exits.

## How to check

1. Disconnect the network, or turn Wi-Fi off.
2. Open a local folder, edit a file, save it, and run a command in the terminal.
3. Search for a string that exists in the folder.
4. Turn the network back on only if you want to call a model provider.

For the crash case, type into a file, do not save, and force-quit Coloride.
Reopen the folder. The unsaved text should be absent. Repeat after saving: the
saved text should be the file on disk.
