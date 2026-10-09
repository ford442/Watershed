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


if __name__ == "__main__":
    unittest.main()
