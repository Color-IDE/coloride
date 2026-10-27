"""Small, persistent project index usable locally or as a standalone VPS script.

The default backend uses literal text, identifier tokens, a small bilingual concept
vocabulary and spelling similarity. It does not claim to provide learned semantic
search. Optional local embeddings live in the sibling ``search_semantic`` module.
Indexing yields after small batches and is the only writer; searches are read-only.
"""

from __future__ import annotations

import argparse
import contextlib
import difflib
import fnmatch
import hashlib
import heapq
import json
import os
import re
import signal
import sqlite3
import stat
import sys
import threading
import time
import unicodedata
from collections.abc import Iterator
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "2"
MAX_FILE_BYTES = 512 * 1024
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_DB_BYTES = 128 * 1024 * 1024
DEFAULT_IGNORED_DIRS = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        "node_modules",
        ".venv",
        "venv",
        "__pycache__",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".next",
        ".nuxt",
        ".cache",
        "dist",
        "build",
        "coverage",
        "target",
        "vendor",
        ".ssh",
    }
)
SECRET_PATTERNS = (".env", ".env.*", "*.pem", "*.key", "id_rsa*", "id_ed25519*", "id_ecdsa*")
IGNORE_FILES = (".gitignore", ".ignore", ".colorideignore")
# Deliberately finite and inspectable: lexical expansion, not a language model.
CONCEPTS = (
    "comida alimento alimentos alimentacion food foods meal meals nutrition nutricion "
    "recipe recipes receta recetas calories calorias ingredients ingredientes",
    "precio precios price prices pricing cost costs coste costo amount importe total subtotal",
    "pago pagos payment payments pay checkout cobro billing factura invoice",
    "descuento descuentos discount discounts coupon cupon promotion promocion",
    "impuesto impuestos tax taxes vat iva",
    "usuario usuarios user users account accounts cuenta cuentas profile perfil",
    "autenticacion authentication auth login signin acceso sesion session sessions token",
    "contrasena password passwords credential credentials credencial credenciales",
    "permiso permisos permission permissions authorization authorize policy policies rol role roles",
    "buscar busqueda search find lookup query queries buscar filtro filter filters",
    "archivo archivos file files fichero ficheros document documents documento documentos",
    "carpeta carpetas directory directories folder folders workspace workspaces proyecto project",
    "guardar guardado save persist persistence store storage almacenamiento",
    "borrar eliminar delete remove removal cleanup limpiar",
    "crear creacion create creation new nuevo",
    "editar modificar actualizar edit modify update mutation escritura write",
    "leer lectura read load fetch cargar carga",
    "error errores errors exception exceptions fallo failure failed fail traceback",
    "registro registros log logs logging logger telemetry telemetria metrics metricas",
    "red network connection connect conexion conectar socket websocket ssh remote remoto",
    "servidor server backend servicio service endpoint api request solicitud response respuesta",
    "base datos database db sql sqlite postgres mysql query consulta",
    "cache cached memoize memoization indice index indexing indexacion",
    "correo email mail message mensaje mensajes notification notificacion",
    "chat conversacion conversation history historial thread hilo",
    "agente agent agents agente herramienta herramientas tool tools function funcion",
    "interfaz interface ui frontend component componente view vista render pantalla screen",
    "boton button click pulsar formulario form input entrada",
    "estilo estilos style styles theme tema color colors colores css",
    "prueba pruebas test tests testing spec assert fixture mock",
    "configuracion config configuration settings setting preference preferences opciones",
    "inicio iniciar startup boot start initialize initialization inicializar onboarding",
    "cerrar cierre shutdown stop terminate exit desconectar disconnect",
    "imagen imagenes image images picture pictures photo foto media asset assets",
    "audio sonido sound voice voz speech hablar microphone microfono",
    "video videos camera camara recording grabacion stream streaming",
    "fecha fechas date dates time tiempo timestamp schedule horario calendar calendario",
    "tarea tareas task tasks job jobs queue cola worker background segundo plano",
    "rapido lentitud slow speed fast latency latencia performance rendimiento cpu memoria memory",
    "terminal consola console shell command comando proceso process subprocess pty",
    "descargar download export exportar upload subir import importar",
    "encriptacion cifrado encrypt encryption decrypt crypto secret secreto seguridad security",
)
STOP_WORDS = frozenset(
    "a al algo and as at by como con de del donde el en es for from how in la las lo los "  # noqa: SIM905
    "me of on or para por que se the to un una unas unos what where which y".split()
)
_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")
_WORD = re.compile(r"[^\W_]+", re.UNICODE)
_CONCEPT_BY_TOKEN: dict[str, set[str]] = {}
for _group in CONCEPTS:
    _members = set(_group.split())
    for _member in _members:
        _CONCEPT_BY_TOKEN.setdefault(_member, set()).update(_members)
_EMBEDDERS: dict[str, Any] = {}


def _normalize(value: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(c))


def tokenize(value: str) -> list[str]:
    """Keep identifier words as well as original identifiers, without stop words."""
    words = _WORD.findall(_normalize(_CAMEL.sub(" ", value)))
    words.extend(_WORD.findall(_normalize(value)))
    return list(dict.fromkeys(w for w in words if 1 < len(w) <= 64 and w not in STOP_WORDS))[:512]


def expand_query(query: str, vocabulary: list[str] | None = None) -> dict[str, float]:
    original = tokenize(query)[:24]
    expanded = {token: 1.0 for token in original}
    for token in original:
        for related in sorted(_CONCEPT_BY_TOKEN.get(token, set())):
            expanded.setdefault(related, 0.48)
        if vocabulary and len(token) >= 4:
            for similar in difflib.get_close_matches(token, vocabulary, n=3, cutoff=0.79):
                expanded.setdefault(similar, 0.60)
    return dict(list(expanded.items())[:192])


def _root(root: str) -> Path:
    selected = Path(root).expanduser().resolve(strict=True)
    if not selected.is_dir():
        raise NotADirectoryError(str(selected))
    return selected


def database_path(root: str, cache_dir: str) -> Path:
    selected = _root(root)
    cache = Path(cache_dir).expanduser().resolve()
    if cache == selected:
        raise ValueError("The search cache cannot be the workspace root")
    identifier = hashlib.sha256(os.fsencode(str(selected))).hexdigest()[:20]
    directory = cache / identifier
    for candidate in (directory, directory / "index.sqlite3", directory / "index.lock", directory / "lease"):
        if candidate.is_symlink():
            raise ValueError("Search cache entries cannot be symbolic links")
    return directory / "index.sqlite3"


def touch_lease(root: str, cache_dir: str) -> None:
    directory = database_path(root, cache_dir).parent
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    (directory / "lease").touch(mode=0o600, exist_ok=True)


def _glob_regex(pattern: str) -> re.Pattern[str]:
    result, cursor = "", 0
    while cursor < len(pattern):
        char = pattern[cursor]
        if pattern[cursor : cursor + 3] == "**/":
            result += "(?:.*/)?"
            cursor += 3
            continue
        if pattern[cursor : cursor + 2] == "**":
            result += ".*"
            cursor += 2
            continue
        if char == "*":
            result += "[^/]*"
        elif char == "?":
            result += "[^/]"
        elif char == "[" and "]" in pattern[cursor + 1 :]:
            end = pattern.index("]", cursor + 1)
            content = pattern[cursor + 1 : end]
            result += "[" + ("^" + re.escape(content[1:]) if content.startswith("!") else content) + "]"
            cursor = end
        else:
            result += re.escape(char)
        cursor += 1
    try:
        return re.compile("^" + result + "$")
    except re.error:
        return re.compile("^" + re.escape(pattern) + "$")


def _read_rules(root: Path, relative: str, inherited: list[Any]) -> list[Any]:
    rules = list(inherited)
    directory = root / relative
    for name in IGNORE_FILES:
        source = directory / name
        try:
            if source.is_symlink() or source.stat().st_size > 64 * 1024:
                continue
            content = source.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line in content.splitlines()[:2000]:
            pattern = line.rstrip()
            if not pattern or pattern.startswith("#"):
                continue
            negate = pattern.startswith("!")
            if negate:
                pattern = pattern[1:]
            if pattern.startswith(("\\#", "\\!")):
                pattern = pattern[1:]
            directory_only = pattern.endswith("/")
            pattern = pattern.rstrip("/")
            anchored = pattern.startswith("/") or "/" in pattern
            pattern = pattern.lstrip("/")
            if pattern:
                rules.append((relative, _glob_regex(pattern), negate, directory_only, anchored))
    return rules


def _ignored(relative: str, is_directory: bool, rules: list[Any]) -> bool:
    parts = relative.split("/")
    if any(part in DEFAULT_IGNORED_DIRS for part in parts):
        return True
    if any(fnmatch.fnmatchcase(parts[-1], pattern) for pattern in SECRET_PATTERNS):
        return True
    ignored = False
    for base, pattern, negate, directory_only, anchored in rules:
        if base and not relative.startswith(base + "/"):
            continue
        scoped = relative[len(base) + 1 :] if base else relative
        if directory_only and not is_directory:
            continue
        if pattern.fullmatch(scoped if anchored else scoped.rsplit("/", 1)[-1]):
            ignored = not negate
    return ignored


def _iter_files(
    root: Path, *, exclude_dirs: tuple[Path, ...] = (), deadline: float | None = None
) -> Iterator[tuple[str, os.stat_result]]:
    """Walk deterministically; never descend into or index symlinks."""
    stack: list[tuple[str, list[Any]]] = [("", [])]
    visited = 0
    produced = False
    while stack:
        relative, inherited = stack.pop()
        visited += 1
        # A slice that already spent its budget on setup must still yield one
        # file. Aborting before that leaves a resume cursor that never moves.
        if visited > 100000 or (
            deadline is not None and produced and time.monotonic() >= deadline
        ):
            yield "", root.stat()
            return
        if root / relative in exclude_dirs:
            continue
        if relative.count("/") > 64:
            yield "", root.stat()
            return
        rules = _read_rules(root, relative, inherited)
        try:
            with os.scandir(root / relative) as iterator:
                entries = []
                for entry in iterator:
                    entries.append(entry)
                    if len(entries) > 50000 or (
                        len(entries) % 256 == 0
                        and deadline is not None
                        and produced
                        and time.monotonic() >= deadline
                    ):
                        yield "", root.stat()
                        return
                entries.sort(key=lambda entry: entry.name)
        except OSError:
            continue
        # Files before directories is intentional; scan continuation uses a count,
        # not lexicographic paths (which differ from this traversal order).
        directories = []
        for entry in entries:
            path = (relative + "/" if relative else "") + entry.name
            try:
                if entry.is_symlink():
                    continue
                is_directory = entry.is_dir(follow_symlinks=False)
                if _ignored(path, is_directory, rules):
                    continue
                if is_directory:
                    directories.append((path, rules))
                elif entry.is_file(follow_symlinks=False):
                    produced = True
                    yield path, entry.stat(follow_symlinks=False)
            except OSError:
                continue
        stack.extend(reversed(directories))


def _allowed_now(root: Path, relative: str) -> bool:
    rules: list[Any] = []
    parent = ""
    parts = relative.split("/")
    for position, part in enumerate(parts):
        rules = _read_rules(root, parent, rules)
        candidate = (parent + "/" if parent else "") + part
        if (root / candidate).is_symlink() or _ignored(candidate, position < len(parts) - 1, rules):
            return False
        parent = candidate
    return True


def _read_file(
    root: Path, relative: str, max_bytes: int = MAX_FILE_BYTES
) -> tuple[str, os.stat_result] | None:
    """Open each path component without following links on POSIX."""
    parts = relative.split("/")
    if any(part in ("", ".", "..") for part in parts):
        return None
    descriptors: list[int] = []
    try:
        if os.open in os.supports_dir_fd and hasattr(os, "O_NOFOLLOW"):
            current = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            descriptors.append(current)
            for part in parts[:-1]:
                current = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
                descriptors.append(current)
            descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=current)
        else:
            candidate = root / relative
            if any((root.joinpath(*parts[:i])).is_symlink() for i in range(1, len(parts) + 1)):
                return None
            if root not in candidate.resolve().parents:
                return None
            descriptor = os.open(candidate, os.O_RDONLY)
        descriptors.append(descriptor)
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_size > max_bytes:
            return None
        with os.fdopen(os.dup(descriptor), "rb") as handle:
            data = handle.read(max_bytes + 1)
        after = os.fstat(descriptor)
        if (
            len(data) > max_bytes
            or b"\0" in data
            or (info.st_mtime_ns, info.st_size) != (after.st_mtime_ns, after.st_size)
        ):
            return None
        return data.decode("utf-8", errors="replace"), info
    except OSError:
        return None
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def _chunks(text: str) -> Iterator[tuple[int, int, str]]:
    lines = text.splitlines()
    start, block, size = 1, [], 0
    for number, line in enumerate(lines, 1):
        # Minified or exceptionally long lines are omitted from the index. The
        # live fallback can still inspect the original bounded-size file.
        if len(line) > 8000:
            if block:
                yield start, number - 1, "\n".join(block)
            start, block, size = number + 1, [], 0
            continue
        if block and (len(block) >= 60 or size + len(line) > 6000):
            yield start, number - 1, "\n".join(block)
            start, block, size = number, [], 0
        block.append(line)
        size += len(line) + 1
    if block:
        yield start, len(lines), "\n".join(block)


def _connect(path: Path, *, write: bool = False, max_db_bytes: int = MAX_DB_BYTES) -> sqlite3.Connection:
    if any(
        candidate.is_symlink() for candidate in (path, Path(str(path) + "-wal"), Path(str(path) + "-shm"))
    ):
        raise ValueError("Search index files cannot be symbolic links")
    if write:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        connection = sqlite3.connect(path, timeout=0.5)
        with contextlib.suppress(OSError):
            path.chmod(0o600)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute("PRAGMA cache_size=-2048")
        page_size = int(connection.execute("PRAGMA page_size").fetchone()[0])
        connection.execute("PRAGMA max_page_count=" + str(max(256, max_db_bytes // page_size)))
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY, mtime_ns INTEGER, size INTEGER, generation TEXT
            );
            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY, path TEXT NOT NULL, start_line INTEGER,
                end_line INTEGER, content TEXT NOT NULL, folded TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
            CREATE TABLE IF NOT EXISTS terms (
                token TEXT NOT NULL, chunk_id INTEGER NOT NULL, weight REAL NOT NULL,
                PRIMARY KEY(token, chunk_id)
            ) WITHOUT ROWID;
            CREATE INDEX IF NOT EXISTS terms_chunk ON terms(chunk_id);
            CREATE TABLE IF NOT EXISTS vectors (
                chunk_id INTEGER PRIMARY KEY, model TEXT NOT NULL, vector TEXT NOT NULL
            );
        """)
        if "omitted" not in {row[1] for row in connection.execute("PRAGMA table_info(files)")}:
            connection.execute("ALTER TABLE files ADD COLUMN omitted INTEGER NOT NULL DEFAULT 0")
        connection.execute("INSERT OR REPLACE INTO meta VALUES ('schema_version', ?)", (SCHEMA_VERSION,))
        connection.commit()
    else:
        connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=0.25)
        connection.execute("PRAGMA query_only=ON")
        connection.execute("PRAGMA cache_size=-2048")
    connection.row_factory = sqlite3.Row
    return connection


def _metadata(connection: sqlite3.Connection) -> dict[str, Any]:
    values = {row[0]: row[1] for row in connection.execute("SELECT key, value FROM meta")}
    return {
        "files": int(values.get("files", "0")),
        "chunks": int(values.get("chunks", "0")),
        "updated_at": float(values.get("updated_at", "0")),
        "pending": values.get("scan_generation", "") != "" or values.get("complete", "0") != "1",
        "skipped": int(values.get("skipped", "0")),
        "limited": values.get("limited", ""),
        "backend": values.get("backend", "lexical"),
        "vector_count": int(values.get("vector_count", "0")),
        "semantic_pending": int(values.get("semantic_pending", "0")),
        "semantic": json.loads(values.get("semantic", '{"enabled":false,"state":"disabled"}')),
    }


def _meta_set(connection: sqlite3.Connection, **values: Any) -> None:
    connection.executemany(
        "INSERT OR REPLACE INTO meta VALUES (?, ?)", [(key, str(value)) for key, value in values.items()]
    )


def _delete_file(connection: sqlite3.Connection, path: str) -> None:
    connection.execute("DELETE FROM terms WHERE chunk_id IN (SELECT id FROM chunks WHERE path=?)", (path,))
    connection.execute("DELETE FROM vectors WHERE chunk_id IN (SELECT id FROM chunks WHERE path=?)", (path,))
    connection.execute("DELETE FROM chunks WHERE path=?", (path,))
    connection.execute("DELETE FROM files WHERE path=?", (path,))


def _embedder(cache_dir: str) -> Any:
    if os.environ.get("COLORIDE_SEARCH_EMBEDDINGS", "").lower() not in ("1", "true", "yes"):
        return None
    if cache_dir not in _EMBEDDERS:
        try:
            if __package__:
                from .search_semantic import EmbeddingBackend
            else:
                from search_semantic import EmbeddingBackend
            _EMBEDDERS[cache_dir] = EmbeddingBackend(cache_dir)
        except ImportError:
            return None
    return _EMBEDDERS[cache_dir]


@contextlib.contextmanager
def _writer_lock(directory: Path) -> Iterator[bool]:
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    filename = directory / "index.lock"
    # flock avoids stale PID races. On Windows, exclusive creation is the
    # fallback; a stale lock is reclaimed only after its process is gone.
    try:
        import fcntl
    except ImportError:
        fcntl = None  # type: ignore[assignment]
    if fcntl is not None:
        with filename.open("a+") as handle:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                yield False
                return
            try:
                yield True
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        return
    try:
        descriptor = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        try:
            pid = int(filename.read_text())
            os.kill(pid, 0)
        except ProcessLookupError:
            filename.unlink(missing_ok=True)
        except (OSError, ValueError):
            pass
        yield False
        return
    try:
        os.write(descriptor, str(os.getpid()).encode())
        os.close(descriptor)
        yield True
    finally:
        filename.unlink(missing_ok=True)


@contextlib.contextmanager
def _index_slot(cache_dir: str) -> Iterator[bool]:
    """At most two indexing slices run per cache, including across processes."""
    directory = Path(cache_dir).expanduser().resolve() / ".slots"
    if directory.is_symlink():
        raise ValueError("Search slot directory cannot be a symbolic link")
    for number in range(2):
        slot = directory / str(number)
        if slot.is_symlink() or (slot / "index.lock").is_symlink():
            raise ValueError("Search slot locks cannot be symbolic links")
        with _writer_lock(slot) as acquired:
            if acquired:
                yield True
                return
    yield False


def index_once(
    root: str,
    cache_dir: str,
    *,
    max_files: int = 20000,
    max_file_bytes: int = MAX_FILE_BYTES,
    max_source_bytes: int = MAX_SOURCE_BYTES,
    max_db_bytes: int = MAX_DB_BYTES,
    batch_size: int = 8,
    pause_seconds: float = 0.03,
    cpu_fraction: float = 0.10,
    max_seconds: float = 20,
    stop_event: threading.Event | None = None,
    _locked: bool = False,
) -> dict[str, Any]:
    """Incrementally update the index; bounded slices resume the persisted scan."""
    selected, location = _root(root), database_path(root, cache_dir)
    if not _locked:
        with _writer_lock(location.parent) as acquired:
            if not acquired:
                return {"pending": True, "busy": True}
            with _index_slot(cache_dir) as available:
                if not available:
                    return {"pending": True, "busy": True}
                return index_once(
                    root,
                    cache_dir,
                    max_files=max_files,
                    max_file_bytes=max_file_bytes,
                    max_source_bytes=max_source_bytes,
                    max_db_bytes=max_db_bytes,
                    batch_size=batch_size,
                    pause_seconds=pause_seconds,
                    cpu_fraction=cpu_fraction,
                    max_seconds=max_seconds,
                    stop_event=stop_event,
                    _locked=True,
                )
    stop = stop_event or threading.Event()
    started, batch_cpu, batch_wall = time.monotonic(), time.process_time(), time.monotonic()
    deadline = started + max(0.05, max_seconds)
    cpu_fraction = max(0.01, min(1.0, cpu_fraction))
    batch_size = max(1, min(32, batch_size))
    updated, processed = 0, 0
    connection = _connect(location, write=True, max_db_bytes=max_db_bytes)
    try:
        meta = {row[0]: row[1] for row in connection.execute("SELECT key, value FROM meta")}
        generation = meta.get("scan_generation") or str(time.time_ns())
        resume = int(meta.get("scan_cursor", "0")) if meta.get("scan_generation") else 0
        source_bytes = int(meta.get("scan_bytes", "0")) if resume else 0
        skipped = int(meta.get("scan_skipped", "0")) if resume else 0
        limited = ""
        _meta_set(connection, scan_generation=generation)
        connection.commit()
        cursor = 0
        complete = True
        backend = _embedder(cache_dir)
        for relative, info in _iter_files(
            selected, exclude_dirs=(location.parent.parent,), deadline=deadline
        ):
            if not relative:
                complete = False
                break
            cursor += 1
            if cursor <= resume:
                continue
            # Setup can consume a short slice. Finish one pending file before
            # that budget ends the walk, so a resume cursor cannot stay at zero.
            if stop.is_set() or (processed and time.monotonic() >= deadline):
                cursor -= 1
                complete = False
                break
            if cursor > max_files:
                limited = "file_limit"
                break
            if source_bytes + min(info.st_size, max_file_bytes) > max_source_bytes:
                limited = "source_bytes_limit"
                break
            source_bytes += min(info.st_size, max_file_bytes)
            previous = connection.execute(
                "SELECT mtime_ns, size, omitted FROM files WHERE path=?", (relative,)
            ).fetchone()
            if previous and (previous[0], previous[1]) == (info.st_mtime_ns, info.st_size):
                connection.execute("UPDATE files SET generation=? WHERE path=?", (generation, relative))
                skipped += previous[2]
            else:
                data = _read_file(selected, relative, max_file_bytes)
                if data is None:
                    _delete_file(connection, relative)
                    skipped += 1
                else:
                    text, actual = data
                    used_pages = (
                        connection.execute("PRAGMA page_count").fetchone()[0]
                        - connection.execute("PRAGMA freelist_count").fetchone()[0]
                    )
                    page_size = connection.execute("PRAGMA page_size").fetchone()[0]
                    if used_pages * page_size + len(text.encode("utf-8")) * 6 + 65536 > max_db_bytes:
                        limited = "database_size_limit"
                        break
                    _delete_file(connection, relative)
                    omitted = int(any(len(line) > 8000 for line in text.splitlines()))
                    connection.execute(
                        "INSERT INTO files VALUES (?, ?, ?, ?, ?)",
                        (relative, actual.st_mtime_ns, actual.st_size, generation, omitted),
                    )
                    path_tokens = set(tokenize(relative))
                    for start_line, end_line, content in _chunks(text):
                        inserted = connection.execute(
                            "INSERT INTO chunks(path, start_line, end_line, content, folded) "
                            "VALUES (?, ?, ?, ?, ?)",
                            (relative, start_line, end_line, content, content.casefold()),
                        )
                        chunk_id = inserted.lastrowid
                        tokens = list(dict.fromkeys(list(sorted(path_tokens)) + tokenize(content)))[:128]
                        connection.executemany(
                            "INSERT INTO terms VALUES (?, ?, ?)",
                            [(token, chunk_id, 1.4 if token in path_tokens else 1.0) for token in tokens],
                        )
                    skipped += omitted
                    updated += 1
            processed += 1
            if processed % batch_size == 0:
                _meta_set(connection, scan_cursor=cursor, scan_bytes=source_bytes, scan_skipped=skipped)
                connection.commit()
                connection.execute("PRAGMA wal_checkpoint(PASSIVE)")
                # Target duty cycle, including tokenization and SQLite work, not
                # merely a fixed sleep which disappears for expensive batches.
                cpu = time.process_time() - batch_cpu
                wall = time.monotonic() - batch_wall
                delay = max(pause_seconds, cpu / cpu_fraction - wall)
                stop.wait(min(max(0.0, delay), max(0.0, deadline - time.monotonic())))
                batch_cpu, batch_wall = time.process_time(), time.monotonic()
        if complete:
            stale = [
                row[0]
                for row in connection.execute("SELECT path FROM files WHERE generation != ?", (generation,))
            ]
            for relative in stale:
                # Files inserted/deleted earlier in a resumed walk can shift the
                # cursor. Preserve unvisited existing files for the next pass;
                # only actually removed/ignored files or a capacity cap are pruned.
                if limited or not (selected / relative).is_file() or not _allowed_now(selected, relative):
                    _delete_file(connection, relative)
            _meta_set(connection, scan_generation="", scan_cursor=0, scan_bytes=0, scan_skipped=0, complete=1)
        else:
            _meta_set(
                connection,
                scan_generation=generation,
                scan_cursor=cursor,
                scan_bytes=source_bytes,
                scan_skipped=skipped,
            )
        # Backfill independently of file changes. This also resumes an interrupted
        # embedding batch or builds vectors when semantic search is enabled later.
        if backend is not None and not stop.is_set() and time.monotonic() < deadline:
            missing = connection.execute(
                "SELECT c.id, c.path, c.content FROM chunks c LEFT JOIN vectors v "
                "ON v.chunk_id=c.id AND v.model=? WHERE v.chunk_id IS NULL LIMIT 64",
                (backend.model_key,),
            ).fetchall()
            for offset in range(0, len(missing), 4):
                if stop.is_set() or time.monotonic() >= deadline:
                    break
                batch = missing[offset : offset + 4]
                cpu_start, wall_start = time.process_time(), time.monotonic()
                try:
                    vectors = backend.embed_documents([row["path"] + "\n" + row["content"] for row in batch])
                except Exception:
                    vectors = []
                if not vectors:
                    break
                for row, vector in zip(batch, vectors):  # noqa: B905 - standalone Python 3.9 support
                    connection.execute(
                        "INSERT OR REPLACE INTO vectors VALUES (?, ?, ?)",
                        (row["id"], backend.model_key, json.dumps(vector, separators=(",", ":"))),
                    )
                connection.commit()
                delay = (time.process_time() - cpu_start) / cpu_fraction - (time.monotonic() - wall_start)
                stop.wait(min(max(0.0, delay), max(0.0, deadline - time.monotonic())))
        file_count = connection.execute("SELECT count(*) FROM files").fetchone()[0]
        chunk_count = connection.execute("SELECT count(*) FROM chunks").fetchone()[0]
        vector_count = (
            connection.execute("SELECT count(*) FROM vectors WHERE model=?", (backend.model_key,)).fetchone()[
                0
            ]
            if backend is not None
            else 0
        )
        semantic_status = getattr(backend, "status", {"enabled": backend is not None, "state": "disabled"})
        _meta_set(
            connection,
            files=file_count,
            chunks=chunk_count,
            skipped=skipped,
            updated_at=time.time(),
            limited=limited,
            backend="lexical+embeddings" if vector_count else "lexical",
            vector_count=vector_count,
            semantic_pending=max(0, chunk_count - vector_count) if backend is not None else 0,
            semantic=json.dumps(semantic_status),
        )
        connection.commit()
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        result = _metadata(connection)
        result.update(
            updated_files=updated,
            processed_files=processed,
            elapsed_ms=round((time.monotonic() - started) * 1000),
        )
        return result
    finally:
        connection.close()


def _scope(root: Path, path: str) -> str:
    candidate = Path(path or ".").expanduser()
    if candidate.is_absolute():
        try:
            relative = candidate.resolve(strict=False).relative_to(root).as_posix()
        except ValueError as exc:
            raise PermissionError("Search path is outside the workspace") from exc
    else:
        relative = candidate.as_posix()
    if ".." in Path(relative).parts:
        raise PermissionError("Search path is outside the workspace")
    return relative.strip("/") if relative != "." else ""


def _in_scope(relative: str, scope: str, includes: list[str]) -> bool:
    if scope and relative != scope and not relative.startswith(scope + "/"):
        return False
    if not includes:
        return True
    return any(
        _glob_regex(pattern).fullmatch(relative)
        or _glob_regex(pattern).fullmatch(relative.rsplit("/", 1)[-1])
        for pattern in includes
    )


def _includes(include: str | list[str]) -> list[str]:
    values = include if isinstance(include, list) else [include]
    return [str(value)[:256] for value in values[:16] if value]


def _match(
    relative: str,
    lines: list[str],
    line: int,
    *,
    query: str,
    kind: str,
    score: float,
    context_lines: int,
    end_line: int | None = None,
) -> dict[str, Any]:
    end = max(line, min(end_line or line, len(lines)))
    start_context, end_context = max(1, line - context_lines), min(len(lines), end + context_lines)
    text = "\n".join(lines[line - 1 : end])
    return {
        "path": relative,
        "line": line,
        "end_line": end,
        "column": max(0, lines[line - 1].casefold().find(query.casefold())) + 1 if lines else 1,
        "text": text[:4000],
        "context": "\n".join(lines[start_context - 1 : end_context])[:6000],
        "context_start_line": start_context,
        "context_end_line": end_context,
        "match_type": kind,
        "score": round(score, 4),
        "text_truncated": len(text) > 4000,
    }


def _related_score(text: str, relative: str, expanded: dict[str, float], original: set[str]) -> float:
    words = set(tokenize(text)) | set(tokenize(relative))
    found = words & expanded.keys()
    if not found:
        return 0.0
    score = sum(expanded[word] for word in found)
    coverage = len(words & original) / max(1, len(original))
    return score * (0.5 + coverage) / max(1.0, len(original) ** 0.5)


def _options(query: str, max_results: int, mode: str, context_lines: int) -> tuple[str, int, int]:
    query = query.strip()
    if not query or len(query) > 2048 or "\0" in query:
        raise ValueError("Search query must contain 1 to 2048 characters and no null bytes")
    if mode not in ("auto", "hybrid", "literal", "exact"):
        raise ValueError("Search mode must be auto, hybrid or literal")
    return query, max(1, min(200, int(max_results))), max(0, min(6, int(context_lines)))


def live_search(
    root: str,
    query: str,
    *,
    path: str = ".",
    include: str | list[str] = "",
    max_results: int = 40,
    case_sensitive: bool = False,
    mode: str = "auto",
    context_lines: int = 2,
    max_seconds: float = 5,
    max_scan_bytes: int = 32 * 1024 * 1024,
    _exclude_dirs: tuple[Path, ...] = (),
) -> dict[str, Any]:
    """Bounded fallback over current files while the background index catches up."""
    query, max_results, context_lines = _options(query, max_results, mode, context_lines)
    selected = _root(root)
    scope, includes = _scope(selected, path), _includes(include)
    needle = query if case_sensitive else query.casefold()
    expanded, original = expand_query(query), set(tokenize(query))
    deadline = time.monotonic() + max(0.05, min(10, max_seconds))
    exact: list[dict[str, Any]] = []
    related: list[tuple[float, int, dict[str, Any]]] = []
    scanned, scanned_bytes, skipped, serial = 0, 0, 0, 0
    truncated = False
    for relative, info in _iter_files(selected, exclude_dirs=_exclude_dirs, deadline=deadline):
        if not relative:
            truncated = True
            break
        if time.monotonic() >= deadline or scanned >= 20000 or scanned_bytes >= max_scan_bytes:
            truncated = True
            break
        if not _in_scope(relative, scope, includes):
            continue
        scanned += 1
        if info.st_size > MAX_FILE_BYTES or scanned_bytes + info.st_size > max_scan_bytes:
            skipped += 1
            continue
        scanned_bytes += info.st_size
        data = _read_file(selected, relative)
        if data is None:
            skipped += 1
            continue
        text, _ = data
        lines = text.splitlines()
        exact_lines = set()
        for number, line in enumerate(lines, 1):
            if needle in (line if case_sensitive else line.casefold()):
                exact.append(
                    _match(
                        relative,
                        lines,
                        number,
                        query=query,
                        kind="exact",
                        score=100.0,
                        context_lines=context_lines,
                    )
                )
                exact_lines.add(number)
                if len(exact) >= max_results + 1:
                    truncated = True
                    break
        if len(exact) > max_results:
            break
        if mode not in ("literal", "exact") and len(exact) < min(5, max_results):
            for first, last, content in _chunks(text):
                if any(first <= number <= last for number in exact_lines):
                    continue
                # A bounded per-chunk vocabulary also handles typos before an
                # index exists, without creating a second on-disk index.
                chunk_expanded = expand_query(query, tokenize(content + " " + relative)[:256])
                score = _related_score(content, relative, chunk_expanded or expanded, original)
                if score >= 0.20:
                    serial += 1
                    result = _match(
                        relative,
                        lines,
                        first,
                        query=query,
                        kind="related",
                        score=score,
                        context_lines=context_lines,
                        end_line=min(last, first + 14),
                    )
                    heapq.heappush(related, (score, serial, result))
                    if len(related) > max_results:
                        heapq.heappop(related)
    matches = exact[:max_results]
    if mode not in ("literal", "exact") and len(matches) < min(5, max_results):
        matches.extend(
            item[2]
            for item in sorted(related, key=lambda item: (-item[0], item[1]))[: max_results - len(matches)]
        )
    return {
        "matches": matches,
        "stage": "expanded"
        if any(m["match_type"] != "exact" for m in matches)
        else "exact"
        if matches
        else "empty",
        "indexed": False,
        "pending": True,
        "truncated": truncated or skipped > 0,
        "scanned_files": scanned,
        "skipped": skipped,
        "backend": "lexical",
        "source": "live",
    }


def search(
    root: str,
    cache_dir: str,
    query: str,
    *,
    path: str = ".",
    include: str | list[str] = "",
    max_results: int = 40,
    case_sensitive: bool = False,
    mode: str = "auto",
    context_lines: int = 2,
    max_seconds: float = 5,
    max_output_bytes: int = 32000,
    fallback: bool = True,
) -> dict[str, Any]:
    """Prefer exact hits, then ranked lexical/optional semantic candidates."""
    query, max_results, context_lines = _options(query, max_results, mode, context_lines)
    selected, location = _root(root), database_path(root, cache_dir)
    scope, includes = _scope(selected, path), _includes(include)
    touch_lease(root, cache_dir)
    deadline = time.monotonic() + max(0.05, min(10, max_seconds))
    result: dict[str, Any] = {
        "matches": [],
        "stage": "empty",
        "indexed": False,
        "pending": True,
        "truncated": False,
        "index": {},
        "backend": "lexical",
        "source": "index",
    }
    if location.exists():
        connection = _connect(location)
        connection.set_progress_handler(lambda: 1 if time.monotonic() >= deadline else 0, 2000)
        try:
            index = _metadata(connection)
            result.update(
                index=index,
                indexed=True,
                pending=index["pending"],
                backend=index["backend"],
                truncated=bool(index["limited"] or index["skipped"]),
                semantic=index["semantic"],
            )
            scope_sql = " AND (c.path=? OR substr(c.path, 1, ?)=?)" if scope else ""
            scope_values: tuple[Any, ...] = (scope, len(scope) + 1, scope + "/") if scope else ()
            if includes:
                patterns = [_glob_regex(pattern) for pattern in includes]
                connection.create_function(
                    "search_included",
                    1,
                    lambda relative: any(
                        pattern.fullmatch(relative) or pattern.fullmatch(relative.rsplit("/", 1)[-1])
                        for pattern in patterns
                    ),
                )
                scope_sql += " AND search_included(c.path)"
            column, needle = ("content", query) if case_sensitive else ("folded", query.casefold())
            rows = connection.execute(
                "SELECT c.*, f.mtime_ns, f.size FROM chunks c JOIN files f ON f.path=c.path "
                f"WHERE instr(c.{column}, ?)>0" + scope_sql + " ORDER BY c.path, c.start_line LIMIT 401",
                (needle, *scope_values),
            ).fetchall()
            if len(rows) > 400:
                result["truncated"] = True
                rows = rows[:400]
            seen: set[tuple[str, int]] = set()
            current_files: dict[str, tuple[str, os.stat_result] | None] = {}
            candidate_bytes = 0

            def current(row: Any) -> tuple[str, list[str]] | None:
                nonlocal candidate_bytes
                relative = row["path"]
                if not _in_scope(relative, scope, includes):
                    return None
                if relative not in current_files:
                    if time.monotonic() >= deadline or candidate_bytes + row["size"] > 8 * 1024 * 1024:
                        result["truncated"] = True
                        return None
                    current_files[relative] = (
                        _read_file(selected, relative) if _allowed_now(selected, relative) else None
                    )
                    candidate_bytes += row["size"]
                data = current_files[relative]
                if data is None or (data[1].st_mtime_ns, data[1].st_size) != (row["mtime_ns"], row["size"]):
                    result["pending"] = True
                    return None
                return data[0], data[0].splitlines()

            for row in rows:
                data = current(row)
                if data is None:
                    continue
                _, lines = data
                for number in range(row["start_line"], min(row["end_line"], len(lines)) + 1):
                    line = lines[number - 1]
                    if (
                        needle in (line if case_sensitive else line.casefold())
                        and (row["path"], number) not in seen
                    ):
                        seen.add((row["path"], number))
                        result["matches"].append(
                            _match(
                                row["path"],
                                lines,
                                number,
                                query=query,
                                kind="exact",
                                score=100.0,
                                context_lines=context_lines,
                            )
                        )
                        if len(result["matches"]) > max_results:
                            result["truncated"] = True
                            break
                if len(result["matches"]) > max_results:
                    break
            result["matches"] = result["matches"][:max_results]
            if mode not in ("literal", "exact") and len(result["matches"]) < min(5, max_results):
                vocabulary: list[str] = []
                for token in tokenize(query)[:12]:
                    vocabulary.extend(
                        row[0]
                        for row in connection.execute(
                            "SELECT DISTINCT token FROM terms WHERE token >= ? AND token < ? LIMIT 160",
                            (token[:1], chr(ord(token[:1]) + 1)),
                        )
                    )
                expanded, original = expand_query(query, vocabulary), set(tokenize(query))
                candidates: dict[int, float] = {}
                if expanded:
                    placeholders = ",".join("?" for _ in expanded)
                    weighted = " + ".join("CASE WHEN t.token=? THEN ? ELSE 0 END" for _ in expanded)
                    ranking_values = tuple(value for pair in expanded.items() for value in pair)
                    related_rows = connection.execute(
                        "SELECT c.id, SUM(t.weight*("
                        + weighted
                        + ")) AS rank FROM terms t JOIN chunks c ON c.id=t.chunk_id "
                        "WHERE t.token IN ("
                        + placeholders
                        + ")"
                        + scope_sql
                        + " GROUP BY c.id ORDER BY rank DESC LIMIT 201",
                        (*ranking_values, *expanded, *scope_values),
                    ).fetchall()
                    if len(related_rows) > 200:
                        result["truncated"] = True
                    candidates.update({row[0]: float(row[1]) for row in related_rows[:200]})
                semantic_scores: dict[int, float] = {}
                backend = _embedder(cache_dir)
                if backend is not None and time.monotonic() < deadline:
                    try:
                        if __package__:
                            from .search_semantic import rank_vectors
                        else:
                            from search_semantic import rank_vectors
                        query_vector = backend.embed_query(query)
                        if query_vector:
                            vectors = connection.execute(
                                "SELECT v.chunk_id, v.vector FROM vectors v "
                                "JOIN chunks c ON c.id=v.chunk_id WHERE v.model=?"
                                + scope_sql
                                + " LIMIT 5001",
                                (backend.model_key, *scope_values),
                            ).fetchall()
                            if len(vectors) > 5000:
                                result["truncated"] = True
                            ranked = rank_vectors(
                                query_vector,
                                ((row[0], json.loads(row[1])) for row in vectors[:5000]),
                                limit=50,
                            )
                            # Cosines from E5 cluster high even for unrelated
                            # passages. Keep only candidates near the best hit;
                            # scores are similarities, never confidence values.
                            best_score = max((score for _, score in ranked), default=0.0)
                            baseline = 0.78 if "e5" in backend.model_key.lower() else 0.30
                            cutoff = max(baseline, best_score - 0.025)
                            semantic_scores = {
                                identifier: score for identifier, score in ranked if score >= cutoff
                            }
                            for identifier, score in semantic_scores.items():
                                candidates[identifier] = max(candidates.get(identifier, 0), score)
                            result["semantic"] = backend.status
                    except Exception as exc:
                        result["semantic"] = {"available": False, "error": type(exc).__name__}
                ranked_matches = []
                for identifier, _ in sorted(candidates.items(), key=lambda item: -item[1])[:250]:
                    if time.monotonic() >= deadline:
                        result["truncated"] = True
                        break
                    row = connection.execute(
                        "SELECT c.*, f.mtime_ns, f.size FROM chunks c "
                        "JOIN files f ON f.path=c.path WHERE c.id=?",
                        (identifier,),
                    ).fetchone()
                    if row is None:
                        continue
                    data = current(row)
                    if data is None:
                        continue
                    _, lines = data
                    first, last = row["start_line"], min(row["end_line"], len(lines))
                    if first > len(lines) or any(
                        (row["path"], number) in seen for number in range(first, last + 1)
                    ):
                        continue
                    content = "\n".join(lines[first - 1 : last])
                    score = _related_score(content, row["path"], expanded, original)
                    kind = "related"
                    if identifier in semantic_scores:
                        score += semantic_scores[identifier]
                        kind = "semantic" if score == semantic_scores[identifier] else "related+semantic"
                    if score >= 0.20:
                        # Anchor the excerpt on its strongest matching line, not
                        # the start of a long chunk that may hide the actual hit.
                        best = max(
                            range(first, last + 1),
                            key=lambda number: _related_score(lines[number - 1], "", expanded, original),
                            default=first,
                        )
                        ranked_matches.append(
                            _match(
                                row["path"],
                                lines,
                                best,
                                query=query,
                                kind=kind,
                                score=score,
                                context_lines=context_lines,
                                end_line=min(last, best + 6),
                            )
                        )
                ranked_matches.sort(key=lambda item: (-item["score"], item["path"], item["line"]))
                result["matches"].extend(ranked_matches[: max_results - len(result["matches"])])
        except sqlite3.OperationalError as exc:
            result.update(
                pending=True, truncated=True, index_error="timeout" if "interrupt" in str(exc) else str(exc)
            )
        finally:
            connection.close()
    # A complete index can still omit large/minified files due to explicit
    # resource bounds. Keep that limitation visible instead of calling it empty.
    if (
        fallback
        and (
            not result["indexed"]
            or result["pending"]
            or not result["matches"]
            or result.get("index", {}).get("skipped")
        )
        and time.monotonic() < deadline
    ):
        live = live_search(
            root,
            query,
            path=path,
            include=include,
            max_results=max_results,
            case_sensitive=case_sensitive,
            mode=mode,
            context_lines=context_lines,
            max_seconds=max(0.05, deadline - time.monotonic()),
            _exclude_dirs=(location.parent.parent,),
        )
        merged = {(item["path"], item["line"]): item for item in result["matches"]}
        for item in live["matches"]:
            merged[(item["path"], item["line"])] = item
        result["matches"] = sorted(
            merged.values(),
            key=lambda item: (item["match_type"] != "exact", -item["score"], item["path"], item["line"]),
        )[:max_results]
        result["truncated"] = result["truncated"] or live["truncated"] or len(merged) > max_results
        result.update(
            source="index+live" if result["indexed"] else "live",
            scanned_files=live["scanned_files"],
            skipped=live["skipped"],
        )
    output_size, bounded = 0, []
    for item in result["matches"]:
        encoded = len(json.dumps(item, ensure_ascii=False).encode("utf-8"))
        if output_size + encoded > max(1024, min(128000, max_output_bytes)):
            result["truncated"] = True
            break
        bounded.append(item)
        output_size += encoded
    result["matches"] = bounded
    result["stage"] = (
        "expanded"
        if any(item["match_type"] != "exact" for item in bounded)
        else "exact"
        if bounded
        else "empty"
    )
    result["expansion"] = "identifier tokens, bilingual concepts and spelling similarity"
    return result


def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("index", "search", "lease"):
        command = commands.add_parser(name)
        command.add_argument("--root", required=True)
        command.add_argument("--cache-dir", required=True)
        if name == "index":
            command.add_argument("--watch", action="store_true")
            command.add_argument("--idle-seconds", type=float, default=120)
            command.add_argument("--poll-seconds", type=float, default=15)
            command.add_argument("--max-seconds", type=float, default=20)
    args = parser.parse_args()
    try:
        if args.command == "lease":
            touch_lease(args.root, args.cache_dir)
            print(json.dumps({"ok": True}))
        elif args.command == "search":
            raw = sys.stdin.buffer.read(16385)
            if len(raw) > 16384:
                raise ValueError("Search request is too large")
            request = json.loads(raw or b"{}")
            allowed = {
                "query",
                "path",
                "include",
                "max_results",
                "case_sensitive",
                "mode",
                "context_lines",
                "max_seconds",
                "max_output_bytes",
                "fallback",
            }
            if not isinstance(request, dict) or set(request) - allowed:
                raise ValueError("Unsupported search request fields")
            print(json.dumps(search(args.root, args.cache_dir, **request), ensure_ascii=False))
        else:
            stop = threading.Event()
            signal.signal(signal.SIGTERM, lambda *_: stop.set())
            signal.signal(signal.SIGINT, lambda *_: stop.set())
            if hasattr(os, "nice"):
                with contextlib.suppress(OSError):
                    os.nice(10)
            touch_lease(args.root, args.cache_dir)
            directory = database_path(args.root, args.cache_dir).parent
            with _writer_lock(directory) as acquired:
                if not acquired:
                    print(json.dumps({"pending": True, "busy": True}), flush=True)
                    return 0
                while not stop.is_set():
                    with _index_slot(args.cache_dir) as available:
                        result = (
                            index_once(
                                args.root,
                                args.cache_dir,
                                max_seconds=args.max_seconds,
                                stop_event=stop,
                                _locked=True,
                            )
                            if available
                            else {"pending": True, "busy": True}
                        )
                    print(json.dumps(result), flush=True)
                    if not args.watch:
                        break
                    try:
                        last_active = (directory / "lease").stat().st_mtime
                    except OSError:
                        break
                    remaining = max(1, args.idle_seconds) - (time.time() - last_active)
                    if remaining <= 0:
                        break
                    progressed = result.get("pending") and result.get("processed_files", 0) > 0
                    poll = (
                        0.5
                        if result.get("busy")
                        else 0.25
                        if progressed and not result.get("limited")
                        else max(1, args.poll_seconds)
                    )
                    stop.wait(min(remaining, poll))
                    if time.time() - (directory / "lease").stat().st_mtime >= max(1, args.idle_seconds):
                        break
    except Exception as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}), flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
