#!/usr/bin/env python3
"""
Unit tests for deploy.py's pure decision functions.

Run: python3 scripts/test_deploy_plan.py   (or `pnpm test:deploy`)

These cover the exact defect from #402: an incremental skip that could split the
unhashed passenger set, leaving an old Emscripten glue beside a new .wasm.
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import deploy  # noqa: E402


IDENTITY = {
    "schema": 1,
    "commit": "c4c1ab3ca958c1230525a15c612ebb0346e5c4af",
    "commitShort": "c4c1ab3",
    "dirty": False,
    "builtAt": "2026-09-09T12:00:00.000Z",
    "wasmStamp": "48807a27dda538ad",
    "glueFile": "watershed_native.js",
    "wasmFile": "watershed_native.wasm",
    "glueBytes": 33562,
    "wasmBytes": 33811,
}

FILES = [
    "index.html",
    "build-identity.json",
    "assets/index-8Gl23hpQ.js",
    "assets/vendor-three-DnVXDa-U.js",
    "watershed_native.js",
    "watershed_native.wasm",
]

LOCAL_SIZES = {
    "index.html": 1438,
    "build-identity.json": 315,
    "assets/index-8Gl23hpQ.js": 887468,
    "assets/vendor-three-DnVXDa-U.js": 1068710,
    "watershed_native.js": 33562,
    "watershed_native.wasm": 33811,
}


class PlanUploadTests(unittest.TestCase):
    def test_full_upload_is_the_default(self):
        upload, skipped = deploy.plan_upload(FILES, LOCAL_SIZES, None)
        self.assertEqual(sorted(FILES), upload)
        self.assertEqual([], skipped)

    def test_incremental_skips_only_content_hashed_assets(self):
        remote = dict(LOCAL_SIZES)  # server already has everything at the same size
        upload, skipped = deploy.plan_upload(FILES, LOCAL_SIZES, remote)
        self.assertEqual(
            ["assets/index-8Gl23hpQ.js", "assets/vendor-three-DnVXDa-U.js"],
            [rel for rel, _ in skipped],
        )
        # The passengers go up regardless — this is the #402 fix.
        for passenger in ("index.html", "build-identity.json",
                          "watershed_native.js", "watershed_native.wasm"):
            self.assertIn(passenger, upload)

    def test_passengers_are_never_split(self):
        """The 08-14 glue / 08-31 wasm shape: same-size glue, changed wasm."""
        remote = dict(LOCAL_SIZES)
        remote["watershed_native.wasm"] = 33817  # differs -> would upload anyway
        upload, _ = deploy.plan_upload(FILES, LOCAL_SIZES, remote)
        self.assertIn("watershed_native.js", upload)
        self.assertIn("watershed_native.wasm", upload)

    def test_incremental_uploads_changed_assets(self):
        remote = dict(LOCAL_SIZES)
        remote["assets/index-8Gl23hpQ.js"] = 12
        upload, skipped = deploy.plan_upload(FILES, LOCAL_SIZES, remote)
        self.assertIn("assets/index-8Gl23hpQ.js", upload)
        self.assertNotIn("assets/index-8Gl23hpQ.js", [rel for rel, _ in skipped])

    def test_unknown_remote_uploads_everything(self):
        upload, skipped = deploy.plan_upload(FILES, LOCAL_SIZES, {})
        self.assertEqual(sorted(FILES), upload)
        self.assertEqual([], skipped)


class PreflightTests(unittest.TestCase):
    def _build(self, tmp: Path, identity=None, glue=33562, wasm=33811):
        build = tmp / "build"
        build.mkdir(parents=True, exist_ok=True)
        (build / "index.html").write_text("<!doctype html>")
        (build / "watershed_native.js").write_bytes(b"g" * glue)
        (build / "watershed_native.wasm").write_bytes(b"w" * wasm)
        if identity is not None:
            (build / "build-identity.json").write_text(json.dumps(identity))
        return build

    def test_accepts_a_coherent_build(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            build = self._build(Path(tmp), IDENTITY)
            # No git in the temp dir -> HEAD comparison is skipped, not failed.
            self.assertEqual(IDENTITY, deploy.preflight(build, allow_dirty=False))

    def test_refuses_a_missing_identity(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            build = self._build(Path(tmp), None)
            with self.assertRaisesRegex(deploy.PreflightError, "missing"):
                deploy.preflight(build, allow_dirty=False)

    def test_refuses_a_passenger_whose_size_contradicts_the_identity(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            build = self._build(Path(tmp), IDENTITY, wasm=33840)
            with self.assertRaisesRegex(deploy.PreflightError, "incoherent"):
                deploy.preflight(build, allow_dirty=False)

    def test_refuses_a_dirty_build_unless_allowed(self):
        import tempfile
        dirty = {**IDENTITY, "dirty": True}
        with tempfile.TemporaryDirectory() as tmp:
            build = self._build(Path(tmp), dirty)
            with self.assertRaisesRegex(deploy.PreflightError, "DIRTY"):
                deploy.preflight(build, allow_dirty=False)
            self.assertEqual(dirty, deploy.preflight(build, allow_dirty=True))

    def test_refuses_a_missing_build_dir(self):
        with self.assertRaisesRegex(deploy.PreflightError, "does not exist"):
            deploy.preflight(Path("/nonexistent/build"), allow_dirty=False)


class FormatTests(unittest.TestCase):
    def test_identity_line_matches_the_js_formatter(self):
        self.assertEqual(
            "commit=c4c1ab3 stamp=48807a27dda538ad glue=33562B wasm=33811B "
            "builtAt=2026-09-09T12:00:00.000Z",
            deploy.format_identity(IDENTITY),
        )

    def test_dirty_is_visible_in_the_identity_line(self):
        self.assertIn("commit=c4c1ab3-dirty", deploy.format_identity({**IDENTITY, "dirty": True}))


if __name__ == "__main__":
    unittest.main(verbosity=2)
