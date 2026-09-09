#!/usr/bin/env python3
"""
deploy.py — package build/ and upload it to storage.noahcohn.com (Contabo).

The server unzips the bundle over one persistent SFTP connection. Actual
FTP/SFTP credentials never leave the VPS.

Usage:
  1. Build:   pnpm build
  2. Rehearse: python3 deploy.py --dry-run      (no network write, no token needed)
  3. Deploy:  export DEPLOY_TOKEN=...; python3 deploy.py
  4. Verify:  node verification/verify_deploy.mjs

WHY THIS FILE IS PARANOID (#402)
--------------------------------
The previous version skipped any file whose REMOTE BYTE SIZE equalled the local
size. Vite's content-hashed asset names can never collide on size-with-same-name,
so that skip could only ever bite the unhashed passengers copied from public/ —
`watershed_native.js` and `watershed_native.wasm`. It duly shipped an 08-31 wasm
binary next to an 08-14 Emscripten glue and left it live for 26 days: the app hung
on load with no console error, and a week of engineering went into fixing code
that was never running.

So:
  * FULL UPLOAD IS THE DEFAULT. `--incremental` is opt-in and still refuses to
    split the passenger set.
  * The passengers (index.html, build-identity.json, watershed_native.*) go up
    together or not at all — they are a single coherent unit.
  * A build/ that is stale or incoherent is refused before any network call.
  * Every run prints the identity being shipped and every file's fate.

Requirements: pip install requests
"""

import argparse
import io
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests

# ============================================================
# PER-PROJECT CONFIGURATION - EDIT THESE
# ============================================================
PROJECT_NAME: str = 'watershed'
BUILD_DIR: str = 'build'
CONTABO_BASE_URL: str = "https://storage.noahcohn.com"
DEPLOY_FOLDER: str = ""  # override remote target folder; empty = use PROJECT_NAME

# Deploy token — REQUIRED for a real upload. Read from the environment; never
# hard-code secrets here and never print this value.
#   export DEPLOY_TOKEN="your_long_token_from_vps_env"
# SECURITY: a token was previously hard-coded here and is now in git history — it
# MUST be treated as compromised. Rotating it on the VPS and scrubbing git history
# remain manual owner actions; this code change only stops new leaks.
DEPLOY_TOKEN: Optional[str] = os.environ.get("DEPLOY_TOKEN")

BUILD_IDENTITY_FILE = "build-identity.json"

# Unhashed files copied verbatim from public/. Content-hashed assets carry their
# identity in the filename; these do not, so they are the only files that can go
# stale in place — and they are only valid as a set.
PASSENGERS: Tuple[str, ...] = (
    "index.html",
    BUILD_IDENTITY_FILE,
    "watershed_native.js",
    "watershed_native.wasm",
    "watershed_native.worker.js",  # threads build only; skipped when absent
)
# ============================================================


class PreflightError(RuntimeError):
    """build/ is stale, incomplete or incoherent — nothing was uploaded."""


# ------------------------------------------------------------------
# Preflight: is this build/ safe to ship?
# ------------------------------------------------------------------

def git_head(repo_root: Path) -> Optional[str]:
    """Current HEAD sha, or None when git is unavailable."""
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_root, capture_output=True, text=True, check=True,
        ).stdout.strip()
    except Exception:
        return None


def load_identity(build_path: Path) -> dict:
    identity_path = build_path / BUILD_IDENTITY_FILE
    if not identity_path.is_file():
        raise PreflightError(
            f"{identity_path} is missing. This build predates build identity — "
            f"rebuild with `pnpm build` before deploying."
        )
    try:
        return json.loads(identity_path.read_text())
    except Exception as exc:
        raise PreflightError(f"{identity_path} is not valid JSON: {exc}") from exc


def format_identity(identity: dict) -> str:
    dirty = "-dirty" if identity.get("dirty") else ""
    return (
        f"commit={identity.get('commitShort', 'unknown')}{dirty} "
        f"stamp={identity.get('wasmStamp', 'unknown')} "
        f"glue={identity.get('glueBytes', 0)}B wasm={identity.get('wasmBytes', 0)}B "
        f"builtAt={identity.get('builtAt', 'unknown')}"
    )


def preflight(build_path: Path, allow_dirty: bool) -> dict:
    """
    Refuse an incoherent build/. Returns the identity on success.

    Checks, in order:
      1. build/ exists and holds an index.html
      2. build-identity.json is present and parsable
      3. the passengers it records are present in build/ at exactly the recorded size
      4. the identity's commit matches the current git HEAD, and the tree was clean
    """
    if not build_path.is_dir():
        raise PreflightError(f"Build directory '{build_path}/' does not exist. Run `pnpm build`.")
    if not (build_path / "index.html").is_file():
        raise PreflightError(f"'{build_path}/index.html' is missing — build/ is not a Vite output.")

    identity = load_identity(build_path)

    recorded = [
        (identity.get("glueFile", "watershed_native.js"), int(identity.get("glueBytes", 0) or 0)),
        (identity.get("wasmFile", "watershed_native.wasm"), int(identity.get("wasmBytes", 0) or 0)),
    ]
    for name, expected in recorded:
        path = build_path / name
        if expected <= 0:
            print(f"  ! {name}: identity records no size (WASM was not built) — assertion skipped")
            continue
        if not path.is_file():
            raise PreflightError(
                f"{name} is recorded in {BUILD_IDENTITY_FILE} ({expected} B) but is not in {build_path}/."
            )
        actual = path.stat().st_size
        if actual != expected:
            raise PreflightError(
                f"{name} is {actual} B in {build_path}/ but {BUILD_IDENTITY_FILE} records {expected} B. "
                f"build/ is incoherent — rebuild with `pnpm build`."
            )

    head = git_head(build_path.resolve().parent)
    built_commit = identity.get("commit", "unknown")
    if head and built_commit != "unknown" and head != built_commit:
        message = (
            f"build/ was built from {built_commit[:7]} but HEAD is {head[:7]} — build/ is stale."
        )
        if not allow_dirty:
            raise PreflightError(f"{message} Rebuild, or pass --allow-dirty to ship it anyway.")
        print(f"  !! WARNING: {message} Shipping anyway (--allow-dirty).")

    if identity.get("dirty"):
        message = "build/ was built from a DIRTY working tree — the live bytes will match no commit."
        if not allow_dirty:
            raise PreflightError(f"{message} Commit first, or pass --allow-dirty.")
        print(f"  !! WARNING: {message} Shipping anyway (--allow-dirty).")

    return identity


# ------------------------------------------------------------------
# Manifest
# ------------------------------------------------------------------

def fetch_remote_sizes(target_folder, target_site="test") -> Dict[str, int]:
    """Ask the VPS for {rel_path: bytes} already on the deploy target."""
    base = CONTABO_BASE_URL.rstrip("/")
    url = f"{base}/api/deploy/{PROJECT_NAME}/sizes"
    headers = {}
    token = globals().get("DEPLOY_TOKEN")
    if token:
        headers["X-Deploy-Token"] = token
    params = {"target_site": target_site or "test"}
    if target_folder:
        params["target_folder"] = target_folder
    try:
        response = requests.get(url, params=params, headers=headers, timeout=60)
        if response.status_code == 200:
            files = response.json().get("files") or {}
            print(f"Remote size map: {len(files)} file(s)")
            return {str(k).replace("\\", "/"): int(v) for k, v in files.items()}
        print(f"  ! sizes HTTP {response.status_code}; uploading all files")
    except Exception as exc:
        print(f"  ! Could not fetch remote sizes ({exc}); uploading all files")
    return {}


def plan_upload(
    files: List[str],
    local_sizes: Dict[str, int],
    remote_sizes: Optional[Dict[str, int]],
) -> Tuple[List[str], List[Tuple[str, str]]]:
    """
    Decide what goes up. Pure: takes relative paths and size maps, returns
    (upload, [(skipped, reason)]).

    `remote_sizes is None` means a full upload (the default) — nothing is skipped.
    In incremental mode a file may be skipped only when the remote byte size
    matches AND the file is not one of the passengers: the passengers are a
    coherent set and are never split (that split is bug #402).
    """
    if remote_sizes is None:
        return sorted(files), []

    upload: List[str] = []
    skipped: List[Tuple[str, str]] = []
    for rel in sorted(files):
        if rel in PASSENGERS:
            upload.append(rel)
            continue
        remote = remote_sizes.get(rel)
        if remote is not None and remote == local_sizes.get(rel):
            skipped.append((rel, f"identical size on target ({remote} B)"))
            continue
        upload.append(rel)
    return upload, skipped


def collect_build_files(build_path: Path) -> Tuple[List[str], Dict[str, int]]:
    files: List[str] = []
    sizes: Dict[str, int] = {}
    for file in sorted(build_path.rglob("*")):
        if file.is_dir():
            continue
        rel = file.relative_to(build_path)
        if any(p in (".git", "node_modules", "__pycache__") for p in rel.parts):
            continue
        rel_s = str(rel).replace("\\", "/")
        files.append(rel_s)
        sizes[rel_s] = file.stat().st_size
    return files, sizes


def build_zip(build_path: Path, members: List[str]) -> bytes:
    """Zip exactly `members` (relative paths) from build_path."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for rel in members:
            zf.write(build_path / rel, rel)
    return buf.getvalue()


# ------------------------------------------------------------------
# Deploy
# ------------------------------------------------------------------

def deploy_bundle(build_path: Path, identity: dict, dry_run: bool, incremental: bool) -> bool:
    target_folder = DEPLOY_FOLDER or PROJECT_NAME
    target_site = globals().get("DEPLOY_TARGET", "test")

    files, local_sizes = collect_build_files(build_path)

    remote_sizes: Optional[Dict[str, int]] = None
    if incremental:
        print("Incremental mode: checking remote file sizes...")
        remote_sizes = fetch_remote_sizes(target_folder, target_site)
    else:
        print("Full upload (default): every file in build/ is shipped.")

    upload, skipped = plan_upload(files, local_sizes, remote_sizes)

    print(f"\nShipping: {format_identity(identity)}")
    print(f"Target:   {CONTABO_BASE_URL}/api/deploy/{PROJECT_NAME}/bundle (target_folder={target_folder!r})")
    print(f"\nFiles ({len(upload)} uploaded, {len(skipped)} skipped):")
    for rel in upload:
        mark = "P" if rel in PASSENGERS else "+"
        print(f"  {mark} {rel} ({local_sizes[rel]} B)")
    for rel, reason in skipped:
        print(f"  = {rel} — skipped: {reason}")
    if skipped:
        print("  (P = unhashed passenger: always uploaded, never split from its pair)")

    if not upload:
        print("\nNothing to upload.")
        return True

    zip_bytes = build_zip(build_path, upload)
    print(f"\nArchive size: {len(zip_bytes) / 1024:.1f} KB")

    if dry_run:
        print("\nDry run: stopping before the network upload. Nothing was sent.")
        return True

    if not DEPLOY_TOKEN:
        print("ERROR: DEPLOY_TOKEN environment variable is not set.")
        print('Set it via: export DEPLOY_TOKEN="your_long_token_from_vps_env"')
        print("Refusing to deploy without an explicit token (no baked-in default).")
        return False

    print("Uploading bundle...")
    try:
        response = requests.post(
            f"{CONTABO_BASE_URL}/api/deploy/{PROJECT_NAME}/bundle",
            files={"bundle": ("build.zip", zip_bytes, "application/zip")},
            data={"target_folder": target_folder},
            headers={"X-Deploy-Token": DEPLOY_TOKEN},
            timeout=300,
        )
    except Exception as exc:
        print(f"  ✗ Upload exception: {exc}")
        return False

    if response.status_code != 200:
        print(f"  ✗ {response.status_code}: {response.text[:400]}")
        return False

    data = response.json()
    print(f"  ✓ {data.get('uploaded', 0)} files uploaded")
    if data.get("failed"):
        print("  Failures:")
        for f in data["failed"]:
            print(f"    ✗ {f['path']}: {f['error']}")
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description="Deploy build/ to storage.noahcohn.com")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Run every check and print the manifest, but stop before uploading.",
    )
    parser.add_argument(
        "--incremental", action="store_true",
        help="Skip files whose remote byte size already matches. Faster, less honest; "
             "the unhashed passengers are uploaded regardless.",
    )
    parser.add_argument(
        "--allow-dirty", action="store_true",
        help="Ship a build/ that is stale relative to HEAD or was built from a dirty tree.",
    )
    args = parser.parse_args()

    print(f"\n=== Deploying '{PROJECT_NAME}' via Contabo -> storage.noahcohn.com ===\n")

    build_path = Path(BUILD_DIR)
    print("Preflight...")
    try:
        identity = preflight(build_path, allow_dirty=args.allow_dirty)
    except PreflightError as exc:
        print(f"\n✗ REFUSING TO DEPLOY: {exc}")
        sys.exit(1)
    print("  ✓ build/ is coherent")

    if not args.dry_run:
        if not DEPLOY_TOKEN:
            print(
                "ERROR: DEPLOY_TOKEN is not set. Export the deploy token before deploying:\n"
                '  export DEPLOY_TOKEN="<your_token_from_vps_env>"',
                file=sys.stderr,
            )
            sys.exit(1)
        try:
            health = requests.get(f"{CONTABO_BASE_URL}/api/deploy/health", timeout=10)
            if health.status_code == 200:
                print(f"Contabo deploy service: {health.json().get('status', 'unknown')}")
        except Exception:
            print("Warning: Could not contact storage.noahcohn.com (continuing anyway).")

    success = deploy_bundle(build_path, identity, dry_run=args.dry_run, incremental=args.incremental)

    if args.dry_run:
        print("\n=== Dry run complete (no upload performed) ===")
        print("Next: export DEPLOY_TOKEN=... && python3 deploy.py "
              "&& node verification/verify_deploy.mjs")
    else:
        print(f"\n=== {'Deployment complete' if success else 'Deployment finished with errors'} ===")
        if success:
            print("Now prove it: node verification/verify_deploy.mjs "
                  f"--expect {identity.get('commit', '')}")
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
