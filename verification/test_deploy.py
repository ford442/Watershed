"""Unit tests for deploy.py's DirectoryIndex-shadow handling (#461).

Run from the repo root:  python3 -m unittest verification.test_deploy -v
Stdlib only; skipped if `requests` (a deploy.py import) is not installed.
"""

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

try:
    import deploy
except ImportError as exc:  # deploy.py imports requests at module level
    deploy = None
    IMPORT_ERROR = str(exc)

FIXTURE = REPO_ROOT / "verification" / "fixtures" / "live-dir-2026-10-04.html"


@unittest.skipIf(deploy is None, "deploy.py is not importable (missing requests?)")
class EncodeShadowTest(unittest.TestCase):
    def setUp(self):
        self.index_bytes = FIXTURE.read_bytes()

    def test_starts_with_utf8_bom_and_round_trips(self):
        out = deploy.encode_shadow(self.index_bytes)
        self.assertEqual(out[:3], b"\xef\xbb\xbf")
        self.assertEqual(out.decode("utf-8-sig"), self.index_bytes.decode("utf-8"))

    def test_idempotent_on_already_bommed_input(self):
        once = deploy.encode_shadow(self.index_bytes)
        self.assertEqual(deploy.encode_shadow(once), once)

    def test_is_not_the_bom_less_bytes_that_blanked_the_page(self):
        # The 2026-09-26 clone wrote index.html verbatim; under `charset=utf-16` those
        # bytes decode as UTF-16LE mojibake. The shadow must not be byte-identical to it.
        self.assertNotEqual(deploy.encode_shadow(self.index_bytes), self.index_bytes)

    def test_not_utf16(self):
        # A UTF-16 clone would double the size and fail `verify:deploy` (not UTF-8).
        out = deploy.encode_shadow(self.index_bytes)
        self.assertEqual(len(out), len(self.index_bytes) + 3)


@unittest.skipIf(deploy is None, "deploy.py is not importable (missing requests?)")
class DirectoryIndexShadowsTest(unittest.TestCase):
    BUILD = {"index.html": 729, "BUILD_ID": 60, "assets/index-CgtdhHQi.js": 10}

    def test_remote_only_root_html_is_a_shadow(self):
        remote = {"index.html": 729, "index.htm": 729, "legacy.html": 100, "assets/x.html": 5, "notes.txt": 9}
        self.assertEqual(
            deploy.directory_index_shadows(remote, self.BUILD),
            ["index.htm", "legacy.html"],
        )

    def test_files_in_the_build_are_not_shadows(self):
        self.assertEqual(deploy.directory_index_shadows({"index.html": 1438}, self.BUILD), [])

    def test_size_heuristic_still_flags_the_old_1438_byte_file(self):
        self.assertEqual(deploy.directory_index_shadows({"mystery.bin": 1438}, self.BUILD), ["mystery.bin"])


@unittest.skipIf(deploy is None, "deploy.py is not importable (missing requests?)")
class BuildZipCloneTest(unittest.TestCase):
    def test_zip_carries_the_bommed_clone_and_the_htaccess(self):
        import io
        import tempfile
        import zipfile

        with tempfile.TemporaryDirectory() as tmp:
            build = Path(tmp)
            (build / "index.html").write_bytes(FIXTURE.read_bytes())
            (build / ".htaccess").write_text("DirectoryIndex index.html\n")
            payload = deploy.encode_shadow((build / "index.html").read_bytes())
            data = deploy.build_zip(build, {}, {"default.html": payload})
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                self.assertIn(".htaccess", zf.namelist())
                self.assertEqual(zf.read("default.html")[:3], b"\xef\xbb\xbf")
                self.assertEqual(zf.read("index.html"), FIXTURE.read_bytes())


@unittest.skipIf(deploy is None, "deploy.py is not importable (missing requests?)")
class UploadOrderTest(unittest.TestCase):
    """The bundle's member order is the upload order: entry document last."""

    HASH_A = "assets/index-CgtdhHQi.js"
    HASH_B = "assets/vendor-three-Ab12_-xY.js"
    CSS = "assets/index-Zz9Yy8Xx.css"

    def _make_build(self, tmp):
        build = Path(tmp)
        (build / "assets").mkdir()
        for rel in (self.HASH_A, self.HASH_B, self.CSS):
            (build / rel).write_text("x")
        # names chosen so plain alphabetical order would put them FIRST
        (build / ".htaccess").write_text("DirectoryIndex index.html\n")
        (build / "BUILD_ID").write_text("abc123\n")
        (build / "index.html").write_bytes(FIXTURE.read_bytes())
        (build / "watershed_native.js").write_text("glue")
        (build / "watershed_native.wasm").write_bytes(b"\0asm")
        (build / "rapier.wasm").write_bytes(b"\0asm")
        (build / "sounds").mkdir()
        (build / "sounds" / "a.mp3").write_text("m")
        return build

    def _names(self, build, extra=None):
        import io
        import zipfile

        data = deploy.build_zip(build, {}, extra)
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            return zf.namelist()

    def test_hashed_assets_and_wasm_pair_first_index_then_build_id_last(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            names = self._names(self._make_build(tmp))
        pos = {n: i for i, n in enumerate(names)}
        hashed = [self.HASH_A, self.HASH_B, self.CSS]
        pair = ["watershed_native.js", "watershed_native.wasm"]
        passengers = [".htaccess", "rapier.wasm", "sounds/a.mp3"]
        self.assertEqual(names[-2:], ["index.html", "BUILD_ID"])
        self.assertEqual(sorted(names[:3]), sorted(hashed))
        self.assertEqual(names[3:5], pair)  # glue before wasm
        for first in hashed + pair:
            for later in passengers + ["index.html", "BUILD_ID"]:
                self.assertLess(pos[first], pos[later], f"{first} must upload before {later}")
        for p in passengers:
            self.assertLess(pos[p], pos["index.html"])

    def test_directory_index_clones_sit_between_index_and_build_id(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            build = self._make_build(tmp)
            clone = deploy.encode_shadow((build / "index.html").read_bytes())
            names = self._names(build, {"default.html": clone, "aaa.html": clone})
        self.assertEqual(names[-4:], ["index.html", "aaa.html", "default.html", "BUILD_ID"])

    def test_order_does_not_depend_on_which_hashed_assets_are_skipped(self):
        import io
        import tempfile
        import zipfile

        with tempfile.TemporaryDirectory() as tmp:
            build = self._make_build(tmp)
            skip = {self.HASH_A: (build / self.HASH_A).stat().st_size}
            with zipfile.ZipFile(io.BytesIO(deploy.build_zip(build, skip))) as zf:
                names = zf.namelist()
        self.assertNotIn(self.HASH_A, names)
        self.assertEqual(names[-2:], ["index.html", "BUILD_ID"])

    def test_rank_table(self):
        r = deploy.upload_rank
        self.assertEqual(r(self.HASH_A), 0)
        self.assertEqual(r("watershed_native.wasm"), 1)
        self.assertEqual(r("sounds/a.mp3"), 2)
        self.assertEqual(r("index.html"), 3)
        self.assertEqual(r("default.html", clone=True), 4)
        self.assertEqual(r("BUILD_ID"), 5)


@unittest.skipIf(deploy is None, "deploy.py is not importable (missing requests?)")
class PruneOrphansTest(unittest.TestCase):
    def _run(self, token, remote, yes=False, dry_run=True, offline=False):
        import contextlib
        import io
        import tempfile
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            build = Path(tmp)
            (build / "index.html").write_text("x")
            (build / "assets").mkdir()
            (build / "assets" / "index-CgtdhHQi.js").write_text("x")
            out = io.StringIO()
            res = deploy.RemoteSizesResult(remote, ok=remote is not None)
            with mock.patch.object(deploy, "DEPLOY_TOKEN", token), \
                    mock.patch.object(deploy, "fetch_remote_sizes", return_value=res) as fetch, \
                    contextlib.redirect_stdout(out):
                code = deploy.prune_orphans(build, offline, yes, dry_run)
        return code, out.getvalue(), fetch

    def test_without_token_says_what_it_would_ask_for_and_exits_0_without_network(self):
        code, out, fetch = self._run(None, {})
        self.assertEqual(code, 0)
        self.assertIn("/api/deploy/watershed/sizes", out)
        self.assertIn("DEPLOY_TOKEN", out)
        fetch.assert_not_called()

    def test_lists_only_files_the_build_lacks_and_flags_shadows(self):
        remote = {"index.html": 1, "assets/index-CgtdhHQi.js": 1, "assets/old-AAAAAAAA.js": 500, "legacy.html": 1438}
        code, out, _ = self._run("tok", remote)
        self.assertEqual(code, 0)
        self.assertIn("assets/old-AAAAAAAA.js", out)
        self.assertIn("legacy.html  [DirectoryIndex shadow candidate]", out)
        self.assertNotIn("assets/index-CgtdhHQi.js", out)
        self.assertIn("Nothing deleted", out)

    def test_yes_never_deletes_anything(self):
        remote = {"assets/old-AAAAAAAA.js": 500}
        for dry_run, expected in ((True, 0), (False, 2)):
            with self.subTest(dry_run=dry_run):
                code, out, _ = self._run("tok", remote, yes=True, dry_run=dry_run)
                self.assertEqual(code, expected)
                self.assertIn("Nothing deleted", out)

    def test_unreachable_sizes_endpoint_is_blocked_not_an_empty_remote(self):
        res = deploy.RemoteSizesResult({}, ok=False, error="HTTP 403")
        import contextlib
        import io
        import tempfile
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(deploy, "DEPLOY_TOKEN", "tok"), \
                mock.patch.object(deploy, "fetch_remote_sizes", return_value=res), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            code = deploy.prune_orphans(Path(tmp), False, False, True)
        self.assertEqual(code, 1)
        self.assertIn("BLOCKED", out.getvalue())


@unittest.skipIf(deploy is None, "deploy.py is not importable (missing requests?)")
class OfflineDryRunTest(unittest.TestCase):
    def test_offline_dry_run_makes_no_request_and_lists_in_upload_order(self):
        import contextlib
        import io
        import tempfile
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            build = Path(tmp)
            (build / "assets").mkdir()
            (build / "assets" / "index-CgtdhHQi.js").write_text("x")
            (build / "index.html").write_text("<html></html>")
            (build / "BUILD_ID").write_text("id\n")
            out = io.StringIO()
            with mock.patch.object(deploy.requests, "get", side_effect=AssertionError("network")), \
                    mock.patch.object(deploy.requests, "post", side_effect=AssertionError("network")), \
                    contextlib.redirect_stdout(out):
                self.assertTrue(deploy.deploy_bundle(build, dry_run=True, offline=True))
        lines = [ln for ln in out.getvalue().splitlines() if "  [" in ln]
        names = [ln.split()[2] for ln in lines]
        self.assertEqual(names, ["assets/index-CgtdhHQi.js", "index.html", "BUILD_ID"])


if __name__ == "__main__":
    unittest.main()
