from __future__ import annotations

import math

import pytest

from coloride_desktop.files.search_semantic import (
    DEFAULT_MODEL,
    MAX_DOCUMENTS,
    MAX_TEXT_CHARS,
    EmbeddingBackend,
    rank_vectors,
)


class FakeModel:
    def __init__(self, **kwargs):
        self.options = kwargs
        self.calls = []

    def embed(self, documents, **kwargs):
        self.calls.append((list(documents), kwargs))
        for _ in documents:
            yield [3.0, 4.0]

    query_embed = embed
    passage_embed = embed


def test_disabled_backend_has_no_import_download_or_cache_side_effects(tmp_path, monkeypatch):
    monkeypatch.delenv("COLORIDE_SEARCH_EMBEDDINGS", raising=False)

    def forbidden(**kwargs):
        raise AssertionError("A disabled backend must not load its dependency")

    cache = tmp_path / "model-cache"
    backend = EmbeddingBackend(cache, model_factory=forbidden)
    assert backend.status["state"] == "disabled"
    assert backend.embed_query("comida") is None
    assert backend.embed_documents(["food"]) == []
    assert not backend.available
    assert not cache.exists()


def test_loading_is_lazy_cached_only_and_uses_a_single_cpu_thread(tmp_path):
    created = []

    def factory(**kwargs):
        model = FakeModel(**kwargs)
        created.append(model)
        return model

    backend = EmbeddingBackend(tmp_path, enabled=True, model_factory=factory)
    assert backend.status["state"] == "not_loaded"
    assert created == []
    assert backend.embed_documents(["calculateCalories()"]) == [[0.6, 0.8]]
    assert len(created) == 1
    options = created[0].options
    assert options["local_files_only"] is True
    assert options["threads"] == 1
    assert options["providers"] == ["CPUExecutionProvider"]
    assert backend.status["state"] == "ready"
    assert backend.status["dimensions"] == 2
    assert backend.model_key.startswith(f"fastembed:v1:{DEFAULT_MODEL}:")


def test_explicit_download_and_model_config_are_forwarded(tmp_path, monkeypatch):
    monkeypatch.setenv("COLORIDE_SEARCH_EMBEDDINGS", "1")
    monkeypatch.setenv("COLORIDE_SEARCH_EMBEDDING_DOWNLOAD", "1")
    monkeypatch.setenv("COLORIDE_SEARCH_EMBEDDING_MODEL", "example/custom-model")
    model = FakeModel()

    def factory(**kwargs):
        model.options = kwargs
        return model

    backend = EmbeddingBackend(tmp_path, model_factory=factory)
    assert backend.embed_query("comida") == [0.6, 0.8]
    assert model.options["model_name"] == "example/custom-model"
    assert model.options["local_files_only"] is False
    assert model.calls[0][0] == ["comida"]
    assert "example/custom-model" in backend.model_key


def test_e5_prefixes_bounded_batches_and_input_length(tmp_path):
    model = FakeModel()
    backend = EmbeddingBackend(tmp_path, enabled=True, batch_size=99, model_factory=lambda **_: model)
    vectors = backend.embed_documents(["food"] * 4 + ["x" * (MAX_TEXT_CHARS + 100)])
    assert len(vectors) == 5
    assert [len(call[0]) for call in model.calls] == [4, 1]
    assert model.calls[0][0][0] == "passage: food"
    assert len(model.calls[1][0][0]) == len("passage: ") + MAX_TEXT_CHARS
    assert all(call[1] == {"batch_size": 4, "parallel": None} for call in model.calls)
    assert backend.embed_query(" comida ") == [0.6, 0.8]
    assert model.calls[-1][0] == ["query: comida"]
    with pytest.raises(ValueError, match="limited"):
        backend.embed_documents(["food"] * (MAX_DOCUMENTS + 1))


def test_query_cache_is_bounded_and_results_cannot_mutate_it(tmp_path):
    model = FakeModel()
    backend = EmbeddingBackend(tmp_path, enabled=True, model_factory=lambda **_: model)
    result = backend.embed_query("comida")
    assert result is not None
    result[0] = 100.0
    assert backend.embed_query("comida") == [0.6, 0.8]
    assert len(model.calls) == 1
    for number in range(65):
        backend.embed_query(str(number))
    assert len(backend._queries) == 64
    backend.embed_query("comida")
    assert len(model.calls) == 67


@pytest.mark.parametrize("exception", [ImportError("missing"), ValueError("uncached model")])
def test_unavailable_dependencies_or_weights_fail_open_without_repeated_loads(tmp_path, exception):
    calls = []

    def factory(**kwargs):
        calls.append(kwargs)
        raise exception

    backend = EmbeddingBackend(tmp_path, enabled=True, model_factory=factory)
    assert backend.embed_documents(["food"]) == []
    assert backend.embed_query("comida") is None
    assert not backend.available
    assert len(calls) == 1
    assert backend.status["state"] == "unavailable"
    assert backend.status["error"]


@pytest.mark.parametrize("bad_vector", [[math.nan, 1], [math.inf, 1], [0, 0], [1]])
def test_invalid_or_changed_vectors_invalidate_model_without_partial_results(tmp_path, bad_vector):
    class BrokenModel(FakeModel):
        def embed(self, documents, **kwargs):
            yield [3, 4]
            yield bad_vector

    backend = EmbeddingBackend(tmp_path, enabled=True, model_factory=lambda **_: BrokenModel())
    assert backend.embed_documents(["food", "recipe"]) == []
    assert backend.status["state"] == "unavailable"
    assert backend.embed_query("comida") is None


def test_rank_vectors_normalizes_skips_invalid_and_orders_by_cosine():
    candidates = [
        ("other", [0, 5]),
        ("near", [2, 1]),
        ("exact", [100, 0]),
        ("broken", [float("nan"), 0]),
        ("wrong-model", [1, 0, 0]),
        ("negative", [-1, 0]),
    ]
    ranked = rank_vectors([5, 0], candidates, limit=2)
    assert [identifier for identifier, _ in ranked] == ["exact", "near"]
    assert ranked[0][1] == 1.0
    assert ranked[1][1] == pytest.approx(2 / math.sqrt(5))


def test_rank_vectors_respects_stream_budget_and_stable_ties():
    consumed = []

    def candidates():
        for identifier in range(10):
            consumed.append(identifier)
            yield identifier, [1, 0]

    assert rank_vectors([1, 0], candidates(), max_candidates=3, limit=2) == [(0, 1.0), (1, 1.0)]
    assert consumed == [0, 1, 2]
    assert rank_vectors([1, 0], candidates(), max_candidates=0) == []
    assert rank_vectors([0, 0], candidates()) == []
    assert rank_vectors([1, 0], candidates(), limit=0) == []
    assert consumed == [0, 1, 2]


def test_rank_vectors_never_compares_caller_identifiers_on_ties():
    first, second = {"name": "a"}, {"name": "b"}
    assert rank_vectors([1], [(first, [1]), (second, [1])]) == [(first, 1.0), (second, 1.0)]
