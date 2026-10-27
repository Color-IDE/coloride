from coloride_desktop.lsp.registry import _is_absolute_root
from coloride_desktop.lsp.servers import known_languages, language_server_for


def test_typescript_aliases_share_vtsls() -> None:
    for language in ("typescript", "javascript", "typescriptreact", "javascriptreact"):
        spec = language_server_for(language)
        assert spec is not None
        assert spec.id == "typescript"
        assert spec.npm_bin == "vtsls"


def test_python_prefers_pyright() -> None:
    spec = language_server_for("python")
    assert spec is not None
    assert spec.id == "python"
    assert "pyright-langserver" in spec.path_bins
    assert spec.npm_package == "pyright"


def test_css_html_json_share_extracted_package() -> None:
    prefixes = {language_server_for(name).npm_prefix for name in ("css", "html", "json")}
    assert prefixes == {"vscode-langservers"}


def test_native_servers_are_path_only() -> None:
    for language, binary in (
        ("go", "gopls"),
        ("rust", "rust-analyzer"),
        ("java", "jdtls"),
    ):
        spec = language_server_for(language)
        assert spec is not None
        assert spec.npm_package is None
        assert binary in spec.path_bins


def test_unknown_language_is_none() -> None:
    assert language_server_for("brainfuck") is None
    assert language_server_for("") is None


def test_clangd_publishes_on_open_and_installs_when_missing() -> None:
    for language in ("c", "cpp"):
        spec = language_server_for(language)
        assert spec is not None
        assert "--background-index" in spec.extra_args
        assert spec.npm_package == "@clangd/clangd"
        assert not any(arg.startswith("--stdio") for arg in spec.extra_args)


def test_absolute_roots_include_local_mac_and_windows() -> None:
    assert _is_absolute_root("/Users/ilyes/project")
    assert _is_absolute_root("C:\\Users\\ilyes\\project")
    assert not _is_absolute_root("src/app.ts")
    assert not _is_absolute_root("")


def test_known_languages_cover_common_ids() -> None:
    known = set(known_languages())
    for language in ("python", "go", "rust", "yaml", "shell", "dockerfile", "php"):
        assert language in known
