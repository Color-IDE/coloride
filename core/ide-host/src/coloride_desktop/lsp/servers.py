"""Language → language-server mapping.

Node servers can be installed under ~/.coloride/lsp/<prefix>.
Native servers (gopls, rust-analyzer, clangd, …) are used only if already on PATH.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class LanguageServerSpec:
    id: str
    path_bins: tuple[str, ...]
    extra_args: tuple[str, ...] = ("--stdio",)
    npm_package: str | None = None
    npm_bin: str | None = None
    npm_prefix: str | None = None
    vtsls_layout: bool = False


# One spec per server process. Several editor language ids share a spec.
_SERVERS: dict[str, LanguageServerSpec] = {
    "typescript": LanguageServerSpec(
        id="typescript",
        path_bins=("vtsls",),
        npm_package="@vtsls/language-server typescript",
        npm_bin="vtsls",
        npm_prefix="typescript",
        vtsls_layout=True,
    ),
    "python": LanguageServerSpec(
        id="python",
        path_bins=("pyright-langserver", "basedpyright-langserver"),
        npm_package="pyright",
        npm_bin="pyright-langserver",
        npm_prefix="python",
    ),
    "json": LanguageServerSpec(
        id="json",
        path_bins=("vscode-json-language-server",),
        extra_args=("--stdio",),
        npm_package="vscode-langservers-extracted",
        npm_bin="vscode-json-language-server",
        npm_prefix="vscode-langservers",
    ),
    "css": LanguageServerSpec(
        id="css",
        path_bins=("vscode-css-language-server",),
        npm_package="vscode-langservers-extracted",
        npm_bin="vscode-css-language-server",
        npm_prefix="vscode-langservers",
    ),
    "html": LanguageServerSpec(
        id="html",
        path_bins=("vscode-html-language-server",),
        npm_package="vscode-langservers-extracted",
        npm_bin="vscode-html-language-server",
        npm_prefix="vscode-langservers",
    ),
    "yaml": LanguageServerSpec(
        id="yaml",
        path_bins=("yaml-language-server",),
        npm_package="yaml-language-server",
        npm_bin="yaml-language-server",
        npm_prefix="yaml",
    ),
    "shell": LanguageServerSpec(
        id="shell",
        path_bins=("bash-language-server",),
        extra_args=("start",),
        npm_package="bash-language-server",
        npm_bin="bash-language-server",
        npm_prefix="shell",
    ),
    "dockerfile": LanguageServerSpec(
        id="dockerfile",
        path_bins=("docker-langserver",),
        npm_package="dockerfile-language-server-nodejs",
        npm_bin="docker-langserver",
        npm_prefix="dockerfile",
    ),
    "php": LanguageServerSpec(
        id="php",
        path_bins=("intelephense",),
        npm_package="intelephense",
        npm_bin="intelephense",
        npm_prefix="php",
    ),
    "toml": LanguageServerSpec(
        id="toml",
        path_bins=("taplo",),
        extra_args=("lsp", "stdio"),
        npm_package="@taplo/cli",
        npm_bin="taplo",
        npm_prefix="toml",
    ),
    "go": LanguageServerSpec(id="go", path_bins=("gopls",)),
    "rust": LanguageServerSpec(id="rust", path_bins=("rust-analyzer",)),
    "cpp": LanguageServerSpec(
        id="cpp",
        path_bins=("clangd",),
        # Same flags VS Code uses so clangd publishes on open instead of waiting.
        extra_args=(
            "--background-index",
            "--clang-tidy",
            "--header-insertion=never",
            "--completion-style=detailed",
        ),
        # Used only when Xcode, Homebrew and PATH have no clangd.
        npm_package="@clangd/clangd",
        npm_bin="clangd",
        npm_prefix="cpp",
    ),
    "ruby": LanguageServerSpec(id="ruby", path_bins=("solargraph",), extra_args=("stdio",)),
    "java": LanguageServerSpec(id="java", path_bins=("jdtls",)),
    "markdown": LanguageServerSpec(id="markdown", path_bins=("marksman",), extra_args=("server",)),
    "xml": LanguageServerSpec(id="xml", path_bins=("lemminx",)),
    "lua": LanguageServerSpec(id="lua", path_bins=("lua-language-server",)),
    "kotlin": LanguageServerSpec(id="kotlin", path_bins=("kotlin-language-server",)),
    "csharp": LanguageServerSpec(id="csharp", path_bins=("csharp-ls",)),
}

_LANGUAGE_TO_SERVER = {
    "typescript": "typescript",
    "javascript": "typescript",
    "typescriptreact": "typescript",
    "javascriptreact": "typescript",
    "python": "python",
    "json": "json",
    "jsonc": "json",
    "css": "css",
    "scss": "css",
    "less": "css",
    "html": "html",
    "yaml": "yaml",
    "dockerfile": "dockerfile",
    "shell": "shell",
    "go": "go",
    "rust": "rust",
    "c": "cpp",
    "cpp": "cpp",
    "php": "php",
    "ruby": "ruby",
    "java": "java",
    "markdown": "markdown",
    "toml": "toml",
    "xml": "xml",
    "lua": "lua",
    "kotlin": "kotlin",
    "csharp": "csharp",
}


def normalize_language(language: str) -> str:
    return (language or "").strip().lower()


def language_server_for(language: str) -> LanguageServerSpec | None:
    server_id = _LANGUAGE_TO_SERVER.get(normalize_language(language))
    if server_id is None:
        return None
    return _SERVERS[server_id]


def known_languages() -> tuple[str, ...]:
    return tuple(sorted(_LANGUAGE_TO_SERVER))
