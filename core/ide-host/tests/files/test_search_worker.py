from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from coloride_desktop.files import search_worker as worker


class SearchWorkerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "project"
        self.root.mkdir()
        self.cache = Path(self.temporary.name) / "cache"

    def write(self, path: str, content: str) -> Path:
        selected = self.root / path
        selected.parent.mkdir(parents=True, exist_ok=True)
        selected.write_text(content, encoding="utf-8")
        return selected

    def index(self, **options):
        return worker.index_once(str(self.root), str(self.cache), pause_seconds=0, cpu_fraction=1, **options)

    def search(self, query: str, **options):
        return worker.search(str(self.root), str(self.cache), query, **options)

    def test_related_identifiers_bilingual_and_typo_results(self) -> None:
        self.write("src/nutrition.py", "def calculateCalories(ingredients):\n    return food_total\n")
        self.write("src/terminal.py", "def attachTerminal():\n    return ssh_channel\n")
        self.index()
        result = self.search("comida")
        self.assertEqual(result["stage"], "expanded")
        self.assertEqual([item["path"] for item in result["matches"]], ["src/nutrition.py"])
        self.assertEqual(result["matches"][0]["match_type"], "related")
        self.assertIn("calculateCalories", result["matches"][0]["text"])
        self.assertEqual(self.search("calroies")["matches"][0]["path"], "src/nutrition.py")
        self.assertEqual(self.search("comida", mode="literal")["matches"], [])
        self.assertEqual(self.search("totallyUnrelatedQuux")["matches"], [])

    def test_exact_case_filters_and_actual_truncation(self) -> None:
        self.write("a.txt", "User\nuser\n")
        self.write("src/a.py", "User\n")
        self.index()
        result = self.search("User", include="**/*.py", case_sensitive=True, mode="literal", max_results=1)
        self.assertEqual(len(result["matches"]), 1)
        self.assertEqual(result["matches"][0]["path"], "src/a.py")
        self.assertFalse(result["truncated"])
        self.assertEqual(
            self.search("user", include="**/*.py", case_sensitive=True, mode="literal")["matches"], []
        )
        self.assertEqual(len(self.search("user", mode="literal")["matches"]), 3)
        self.assertTrue(self.search("user", mode="literal", max_results=2)["truncated"])
        self.assertEqual(
            self.search("User", path=str(self.root / "src"), mode="literal")["matches"][0]["path"], "src/a.py"
        )
        self.assertEqual(len(self.search("User", path="a.txt", mode="literal")["matches"]), 2)

    def test_filters_apply_before_sql_candidate_limit(self) -> None:
        for number in range(410):
            self.write(f"a{number:03}.txt", "needle")
        self.write("z.py", "needle")
        self.index()
        result = self.search("needle", include="*.py", mode="literal")
        self.assertEqual([item["path"] for item in result["matches"]], ["z.py"])
        self.assertFalse(result["truncated"])

    def test_incremental_updates_deletes_and_stale_content(self) -> None:
        path = self.write("main.py", "old_value = 1\n")
        first = self.index()
        self.assertEqual(first["updated_files"], 1)
        self.assertEqual(self.index()["updated_files"], 0)
        path.write_text("new_value = 12345\n")
        fresh = self.search("new_value", mode="literal")
        self.assertEqual(fresh["matches"][0]["text"], "new_value = 12345")
        self.assertEqual(fresh["source"], "index+live")
        stale = self.search("old_value", mode="literal")
        self.assertTrue(stale["pending"])
        self.assertEqual(stale["matches"], [])
        self.index()
        self.assertEqual(self.search("new_value", mode="literal")["matches"][0]["line"], 1)
        path.unlink()
        self.assertEqual(self.search("new_value", mode="literal")["matches"], [])
        self.assertEqual(self.index()["files"], 0)

    def test_default_and_nested_ignores_and_symlinks(self) -> None:
        self.write("visible.py", "needle")
        self.write(".gitignore", "*.log\nignored/\n")
        self.write("child/.ignore", "*.txt\n!keep.txt\n")
        self.write(".colorideignore", "custom.py\n")
        for path in (
            "hidden.log",
            "ignored/a.py",
            "child/no.txt",
            "custom.py",
            ".env",
            ".env.local",
            "secret.pem",
            "id_rsa",
            "node_modules/a.py",
            ".git/config",
        ):
            self.write(path, "needle")
        self.write("child/keep.txt", "needle")
        outside = Path(self.temporary.name) / "outside.py"
        outside.write_text("needle")
        (self.root / "link.py").symlink_to(outside)
        (self.root / "linked_directory").symlink_to(self.root / "child", target_is_directory=True)
        self.index()
        result = self.search("needle", mode="literal")
        self.assertEqual({item["path"] for item in result["matches"]}, {"visible.py", "child/keep.txt"})
        self.write(".colorideignore", "custom.py\nvisible.py\n")
        self.assertNotIn(
            "visible.py", {item["path"] for item in self.search("needle", mode="literal")["matches"]}
        )
        self.index()
        with sqlite3.connect(worker.database_path(str(self.root), str(self.cache))) as connection:
            self.assertIsNone(connection.execute("SELECT path FROM files WHERE path='visible.py'").fetchone())

    def test_live_fallback_before_index_and_resource_limits(self) -> None:
        self.write("src/nutrition.py", "foodProducts = ingredients\n")
        initial = self.search("comida")
        self.assertFalse(initial["indexed"])
        self.assertTrue(initial["pending"])
        self.assertEqual(initial["source"], "live")
        self.assertEqual(initial["matches"][0]["path"], "src/nutrition.py")
        self.write("huge.txt", "x" * (worker.MAX_FILE_BYTES + 1))
        self.write("binary.dat", "nul\0bytes")
        indexed = self.index()
        self.assertEqual(indexed["skipped"], 2)
        self.assertTrue(self.search("missing")["truncated"])

    def test_long_line_literal_fallback(self) -> None:
        self.write("generated.js", "needle " + "x" * 9000)
        self.index()
        self.index()  # Omission metadata survives an unchanged incremental pass.
        result = self.search("needle", mode="literal")
        self.assertEqual(result["matches"][0]["path"], "generated.js")
        self.assertTrue(result["truncated"])

    def test_cache_in_workspace_is_excluded_and_symlink_cache_rejected(self) -> None:
        self.cache = self.root / "cache"
        self.write("main.py", "needle")
        self.index()
        self.assertEqual(self.index()["files"], 1)
        self.assertEqual(len(self.search("needle", mode="literal")["matches"]), 1)
        location = worker.database_path(str(self.root), str(self.cache))
        other = Path(self.temporary.name) / "outside.sqlite3"
        other.write_text("outside")
        location.unlink()
        location.symlink_to(other)
        with self.assertRaises(ValueError):
            self.search("needle")

    def test_scope_rejects_escape(self) -> None:
        with self.assertRaises(PermissionError):
            self.search("needle", path="../outside")
        with self.assertRaises(PermissionError):
            self.search("needle", path=str(Path(self.temporary.name) / "outside"))
        with self.assertRaises(ValueError):
            self.search("x" * 2049)

    def test_resume_and_single_writer(self) -> None:
        for number in range(20):
            self.write(f"f{number:02}.py", "needle")
        pending = worker.index_once(
            str(self.root), str(self.cache), batch_size=1, pause_seconds=0.10, max_seconds=0.05
        )
        self.assertTrue(pending["pending"])
        self.assertGreater(pending["files"], 0)
        self.assertLess(pending["files"], 20)
        resumed = self.index()
        self.assertFalse(resumed["pending"])
        self.assertEqual(resumed["files"], 20)
        with worker._writer_lock(worker.database_path(str(self.root), str(self.cache)).parent) as acquired:
            self.assertTrue(acquired)
            self.assertTrue(self.index()["busy"])

    def test_embedding_backfill_when_enabled_after_indexing(self) -> None:
        class FakeBackend:
            model_key = "fake-v1"
            calls = 0

            def embed_documents(self, texts):
                self.calls += 1
                return [[1.0, 0.0] for _ in texts]

        self.write("main.py", "food = 1")
        self.index()
        backend = FakeBackend()
        with patch.object(worker, "_embedder", return_value=backend):
            self.assertEqual(self.index()["updated_files"], 0)
            self.assertEqual(backend.calls, 1)
            self.index()
            self.assertEqual(backend.calls, 1)
            backend.model_key = "fake-v2"
            self.index()
            self.assertEqual(backend.calls, 2)
        with sqlite3.connect(worker.database_path(str(self.root), str(self.cache))) as connection:
            self.assertEqual(connection.execute("SELECT model FROM vectors").fetchone()[0], "fake-v2")

    def test_index_concurrency_slots_are_shared_and_bounded(self) -> None:
        with worker._index_slot(str(self.cache)) as first:
            self.assertTrue(first)
            with worker._index_slot(str(self.cache)) as second:
                self.assertTrue(second)
                with worker._index_slot(str(self.cache)) as third:
                    self.assertFalse(third)
                self.assertTrue(self.index()["busy"])
            self.assertFalse(self.index().get("busy", False))

    def test_standalone_cli_search_and_idle_daemon(self) -> None:
        self.write("food.py", "foodProducts = 1")
        script = str(Path(worker.__file__).resolve())
        common = ["--root", str(self.root), "--cache-dir", str(self.cache)]
        environment = dict(os.environ, COLORIDE_SEARCH_EMBEDDINGS="0")
        result = subprocess.run(
            [sys.executable, script, "index", *common],
            capture_output=True,
            text=True,
            check=True,
            env=environment,
        )
        self.assertEqual(json.loads(result.stdout)["files"], 1)
        result = subprocess.run(
            [sys.executable, script, "search", *common],
            input=json.dumps({"query": "comida"}),
            capture_output=True,
            text=True,
            check=True,
            env=environment,
        )
        self.assertEqual(json.loads(result.stdout)["matches"][0]["path"], "food.py")
        daemon = subprocess.Popen(
            [
                sys.executable,
                script,
                "index",
                *common,
                "--watch",
                "--idle-seconds",
                "1",
                "--poll-seconds",
                "1",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=environment,
        )
        try:
            stdout, stderr = daemon.communicate(timeout=5)
            self.assertEqual(daemon.returncode, 0, stderr)
            self.assertGreaterEqual(len(stdout.splitlines()), 1)
        finally:
            if daemon.poll() is None:
                daemon.terminate()
                daemon.wait(timeout=3)


if __name__ == "__main__":
    unittest.main()
