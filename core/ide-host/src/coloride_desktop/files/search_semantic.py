"""Optional local embeddings for the standalone workspace search worker.

This file deliberately imports only the standard library until embeddings are
requested. Install ``fastembed>=0.8,<0.9`` and set
``COLORIDE_SEARCH_EMBEDDINGS=1`` to use a previously cached model. Downloading
weights additionally requires ``COLORIDE_SEARCH_EMBEDDING_DOWNLOAD=1``. No source
code or query is sent to a hosted inference service.

The default is the original E5 publisher's 118 MB quantized multilingual model.
Its private registry name pins the artifact, pooling and prefix contract rather
than depending on a future FastEmbed built-in registration. Other FastEmbed
models can be selected with ``COLORIDE_SEARCH_EMBEDDING_MODEL``.

Call this synchronous module from the background worker, never the ASGI event
loop. The worker owns scheduling and persists vectors alongside ``model_key``;
only vectors with the same key may be compared. CPU inference uses one thread
and small serial batches. The worker should yield between indexing calls.
"""

from __future__ import annotations

import heapq
import math
import os
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Iterable, Sequence
from itertools import islice
from pathlib import Path
from typing import Any, TypeVar

DEFAULT_MODEL = "coloride/multilingual-e5-small-int8"
DEFAULT_MODEL_SOURCE = "intfloat/multilingual-e5-small"
DEFAULT_MODEL_FILE = "onnx/model_qint8_avx512_vnni.onnx"
MAX_DOCUMENTS = 64
MAX_TEXT_CHARS = 6000
MAX_VECTOR_DIMENSIONS = 4096
MAX_CANDIDATES = 5000
_TRUE = frozenset({"1", "true", "yes", "on"})
_REGISTRY_LOCK = threading.Lock()
_Id = TypeVar("_Id")


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in _TRUE


def _fastembed_factory(**kwargs: Any) -> Any:
    # Keep ONNX, NumPy and tokenizer imports out of normal search/startup. Rayon
    # tokenization is also kept serial; this runs only in the search process.
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    from fastembed import TextEmbedding

    if kwargs["model_name"] == DEFAULT_MODEL:
        from fastembed.common.model_description import ModelSource, PoolingType

        with _REGISTRY_LOCK:
            if not any(model["model"] == DEFAULT_MODEL for model in TextEmbedding.list_supported_models()):
                TextEmbedding.add_custom_model(
                    model=DEFAULT_MODEL,
                    pooling=PoolingType.MEAN,
                    normalization=True,
                    sources=ModelSource(hf=DEFAULT_MODEL_SOURCE),
                    dim=384,
                    model_file=DEFAULT_MODEL_FILE,
                    description="Quantized multilingual E5 small with query/passage prefixes.",
                    license="mit",
                    size_in_gb=0.119,
                )
    return TextEmbedding(**kwargs)


def _normalized(values: Iterable[float]) -> list[float]:
    try:
        vector = [float(value) for value in islice(values, MAX_VECTOR_DIMENSIONS + 1)]
    except (TypeError, ValueError, OverflowError):
        return []
    if not vector or len(vector) > MAX_VECTOR_DIMENSIONS or not all(map(math.isfinite, vector)):
        return []
    magnitude = math.sqrt(math.fsum(value * value for value in vector))
    if not math.isfinite(magnitude) or magnitude <= 0:
        return []
    return [value / magnitude for value in vector]


class EmbeddingBackend:
    """Lazy, fail-open embedding adapter with bounded batches and query cache.

    Unavailable models return ``[]`` for documents and ``None`` for queries, so
    callers retain textual search. Availability failures are remembered for the
    process lifetime; restarting the worker retries after installing/caching a
    model. ``status`` is read-only and never loads a model; ``available`` may
    initialize it and must only be read by the background worker.
    """

    def __init__(
        self,
        cache_dir: str | Path,
        *,
        model_name: str | None = None,
        enabled: bool | None = None,
        allow_download: bool | None = None,
        batch_size: int = 4,
        model_factory: Callable[..., Any] | None = None,
    ) -> None:
        self.cache_dir = Path(cache_dir)
        self.model_name = model_name or os.environ.get("COLORIDE_SEARCH_EMBEDDING_MODEL") or DEFAULT_MODEL
        self.enabled = _flag("COLORIDE_SEARCH_EMBEDDINGS") if enabled is None else enabled
        self.allow_download = (
            _flag("COLORIDE_SEARCH_EMBEDDING_DOWNLOAD") if allow_download is None else allow_download
        )
        self.batch_size = max(1, min(int(batch_size), 4))
        self._factory = model_factory or _fastembed_factory
        self._model: Any = None
        self._attempted = False
        self._error: str | None = None
        self._dimensions: int | None = None
        self._lock = threading.RLock()
        self._queries: OrderedDict[str, list[float]] = OrderedDict()

    @property
    def model_key(self) -> str:
        """Persist this key with vectors to reject incompatible cached values."""
        return f"fastembed:v1:{self.model_name}:chars={MAX_TEXT_CHARS}:retrieval"

    @property
    def status(self) -> dict[str, Any]:
        with self._lock:
            state = "disabled"
            if self.enabled:
                state = (
                    "ready" if self._model is not None else "unavailable" if self._attempted else "not_loaded"
                )
            return {
                "enabled": self.enabled,
                "state": state,
                "model": self.model_name,
                "model_key": self.model_key,
                "dimensions": self._dimensions,
                "download_allowed": self.allow_download,
                "error": self._error,
            }

    @property
    def available(self) -> bool:
        with self._lock:
            return self._load()

    def _load(self) -> bool:
        if not self.enabled:
            return False
        if self._attempted:
            return self._model is not None
        self._attempted = True
        try:
            self._model = self._factory(
                model_name=self.model_name,
                cache_dir=str(self.cache_dir),
                threads=1,
                providers=["CPUExecutionProvider"],
                local_files_only=not self.allow_download,
                lazy_load=False,
            )
            return True
        except ImportError:
            self._error = "Optional fastembed dependency is unavailable."
        except Exception as exc:
            # Do not put library errors (which may include input text) in tool
            # responses. Failure must not prevent the worker's lexical index.
            self._error = f"Embedding model could not be loaded ({type(exc).__name__})."
        return False

    def _embed(self, texts: list[str], *, query: bool) -> list[list[float]]:
        try:
            if self.model_name == DEFAULT_MODEL or "e5" in self.model_name.lower():
                prefix = "query: " if query else "passage: "
                output = self._model.embed(
                    [prefix + text for text in texts], batch_size=self.batch_size, parallel=None
                )
            else:
                method = self._model.query_embed if query else self._model.passage_embed
                output = method(texts, batch_size=self.batch_size, parallel=None)
            vectors = [_normalized(vector) for vector in islice(output, len(texts) + 1)]
            if len(vectors) != len(texts) or any(not vector for vector in vectors):
                raise ValueError("Invalid embedding batch")
            dimensions = len(vectors[0])
            if any(len(vector) != dimensions for vector in vectors):
                raise ValueError("Inconsistent embedding dimensions")
            if self._dimensions is not None and dimensions != self._dimensions:
                raise ValueError("Embedding dimensions changed")
            self._dimensions = dimensions
            return vectors
        except Exception as exc:
            self._error = f"Embedding inference failed ({type(exc).__name__})."
            self._model = None
            self._queries.clear()
            return []

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        """Embed up to 64 chunks, serially; return no partial batches on failure.

        The worker must split larger queues into calls and yield between them.
        Text beyond 6000 characters is deliberately outside the embedding's
        scope (the model also truncates tokens); original chunks remain stored
        by the worker for full-text search and result verification.
        """
        if len(texts) > MAX_DOCUMENTS:
            raise ValueError(f"Embedding calls are limited to {MAX_DOCUMENTS} documents")
        if not texts:
            return []
        with self._lock:
            if not self._load():
                return []
            vectors: list[list[float]] = []
            for offset in range(0, len(texts), self.batch_size):
                batch = [str(text)[:MAX_TEXT_CHARS] for text in texts[offset : offset + self.batch_size]]
                result = self._embed(batch, query=False)
                if not result:
                    return []
                vectors.extend(result)
                if offset + self.batch_size < len(texts):
                    time.sleep(0.02)
            return vectors

    def embed_query(self, text: str) -> list[float] | None:
        text = text.strip()[:MAX_TEXT_CHARS]
        if not text:
            return None
        with self._lock:
            cached = self._queries.get(text)
            if cached is not None:
                self._queries.move_to_end(text)
                return list(cached)
            if not self._load():
                return None
            vectors = self._embed([text], query=True)
            if not vectors:
                return None
            self._queries[text] = vectors[0]
            if len(self._queries) > 64:
                self._queries.popitem(last=False)
            return list(vectors[0])


def rank_vectors(  # noqa: UP047 - standalone VPS helper also supports Python 3.9
    query: Sequence[float],
    candidates: Iterable[tuple[_Id, Sequence[float]]],
    *,
    limit: int = 20,
    max_candidates: int = MAX_CANDIDATES,
    min_score: float = 0.0,
) -> list[tuple[_Id, float]]:
    """Cosine-rank a bounded candidate stream without retaining all vectors.

    Inputs may be unnormalized. Invalid/different-dimensional vectors are
    skipped. At most 5000 candidate rows and 200 results are processed. The
    caller must report partial coverage if its vector table exceeds the cap;
    the cap is a resource boundary, not evidence that later rows are irrelevant.
    """
    query_vector = _normalized(query)
    limit = min(200, max(0, int(limit)))
    max_candidates = min(MAX_CANDIDATES, max(0, int(max_candidates)))
    if not query_vector or not limit or not max_candidates:
        return []
    best: list[tuple[float, int, _Id]] = []
    for position, (identifier, values) in enumerate(islice(candidates, max_candidates)):
        vector = _normalized(values)
        if len(vector) != len(query_vector):
            continue
        score = max(-1.0, min(1.0, math.fsum(a * b for a, b in zip(query_vector, vector))))  # noqa: B905 - Python 3.9; lengths checked above
        if score < min_score:
            continue
        # Position is unique, keeps ties stable, and avoids comparing caller IDs.
        candidate = (score, -position, identifier)
        if len(best) < limit:
            heapq.heappush(best, candidate)
        elif candidate[:2] > best[0][:2]:
            heapq.heapreplace(best, candidate)
    return [(identifier, score) for score, _, identifier in sorted(best, reverse=True)]
