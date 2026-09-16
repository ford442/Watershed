#!/usr/bin/env python3
"""
project_deploy_template.py

Copy this file into your project as `deploy.py` (or deploy_contabo.py).
Customize the constants at the top for your project.

Usage:
  1. Build your project:  npm run build   (or python build, etc.)
  2. python deploy.py

This script contacts https://storage.noahcohn.com (your Contabo storage manager)
to upload your entire build as a single zip archive.  The server extracts it and
pushes all files over one persistent SFTP connection — much faster than uploading
files individually.

Actual FTP/SFTP credentials never leave the VPS.

Requirements:
  pip install requests
"""

import argparse
import io
import os
import re
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

# Deploy token — REQUIRED. Read from the environment; never hard-code secrets here.
#   export DEPLOY_TOKEN="your_long_token_from_vps_env"
# SECURITY: a token was previously hard-coded here and is now in git history — it
# MUST be treated as compromised. Rotating it on the VPS and scrubbing git history
# remain manual owner actions; this code change only stops new leaks.
DEPLOY_TOKEN: Optional[str] = os.environ.get("DEPLOY_TOKEN")
# ============================================================

# Live directory URL on 2026-09-16 served a 1438-byte UTF-16LE document that is
# NOT index.html (index.html is 718-byte UTF-8, different mtime/etag). Apache
# DirectoryIndex resolves /watershed/ to that shadow. Overwrite any remote-only
# root HTML (and any 1438-byte root file) with the current UTF-8 index.html.
DIRECTORY_INDEX_SHADOW_SIZE = 1438
DIRECTORY_INDEX_NAME_RE = re.compile(
    r"^(index|default|home|welcome).*\.html?$",
    re.IGNORECASE,
)

# Vite/Rollup content-hashed names only. Unhashed passengers (index.html,
# BUILD_ID, watershed_native.*, textures, sounds, …) always upload.
HASHED_ASSET_RE = re.compile(r"^assets/[^/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$")

# INVARIANT: glue + wasm (+ pthread worker if present) are one emcc output.
# Mixing 3.1.x glue with 6.x wasm throws at __embind_register_value_object_field.
# Never size-check these independently.
NATIVE_PAIR = (
    "watershed_native.js",
    "watershed_native.wasm",
    "watershed_native.worker.js",
)


class RemoteSizesResult:
    """Outcome of GET /api/deploy/<project>/sizes."""

    def __init__(
        self,
        files: Dict[str, int],
        ok: bool,
        status_code: Optional[int] = None,
        error: Optional[str] = None,
    ):
        self.files = files
        self.ok = ok
        self.status_code = status_code
        self.error = error


# When True, chatter goes to stderr so stdout can be a TSV manifest.
QUIET = False


def _log(message: str) -> None:
    """Human-facing deploy chatter. --manifest keeps stdout as TSV only."""
    print(message, file=sys.stderr if QUIET else sys.stdout)


def fetch_remote_sizes(target_folder, target_site="test") -> RemoteSizesResult:
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
            mapped = {str(k).replace("\\", "/"): int(v) for k, v in files.items()}
            _log(f"Remote size map: {len(mapped)} file(s)")
            return RemoteSizesResult(mapped, ok=True, status_code=200)
        _log(f"  ! sizes HTTP {response.status_code}; uploading all files")
        return RemoteSizesResult(
            {},
            ok=False,
            status_code=response.status_code,
            error=f"HTTP {response.status_code}",
        )
    except Exception as exc:
        _log(f"  ! Could not fetch remote sizes ({exc}); uploading all files")
        return RemoteSizesResult({}, ok=False, error=str(exc))


def local_build_files(build_path: Path) -> Dict[str, int]:
    files: Dict[str, int] = {}
    for file in build_path.rglob("*"):
        if file.is_dir():
            continue
        rel = file.relative_to(build_path)
        parts = rel.parts
        if any(p in (".git", "node_modules", "__pycache__") for p in parts):
            continue
        rel_s = str(rel).replace("\\", "/")
        files[rel_s] = file.stat().st_size
    return files


def is_zip_root(rel_s: str) -> bool:
    return "/" not in rel_s.rstrip("/")


def directory_index_shadows(
    remote_files: Dict[str, int],
    build_files: Dict[str, int],
) -> List[str]:
    """Remote-only root paths that Apache DirectoryIndex might serve instead of index.html.

    Heuristic (we cannot guess the live 1438-byte name from outside):
      - any root file whose remote size is 1438 (the UTF-16 shadow measured 2026-09-16)
      - root names matching index/default/home/welcome*.htm(l)
      - any other remote-only root *.htm / *.html
    Cloning UTF-8 index.html onto every candidate makes the directory URL the
    deploy's responsibility even before the owner names the shadow via --list-remote.
    """
    shadows = set()
    for rel, size in remote_files.items():
        if not is_zip_root(rel):
            continue
        if rel in build_files:
            continue
        name = rel.split("/")[-1]
        lower = name.lower()
        if size == DIRECTORY_INDEX_SHADOW_SIZE:
            shadows.add(rel)
            continue
        if DIRECTORY_INDEX_NAME_RE.match(name):
            shadows.add(rel)
            continue
        if lower.endswith(".htm") or lower.endswith(".html"):
            shadows.add(rel)
    return sorted(shadows)


def list_remote(build_path: Path, remote: RemoteSizesResult) -> int:
    """Print the remote size map grouped into build-overlap vs orphans. Returns exit code."""
    if not DEPLOY_TOKEN:
        print(
            "BLOCKED — needs owner: DEPLOY_TOKEN is not set.\n"
            "Export the deploy token and re-run:\n"
            "  python3 deploy.py --list-remote\n"
            "The 1438-byte root HTML file is the DirectoryIndex shadow that\n"
            "https://test.1ink.us/watershed/ actually serves."
        )
        return 1
    if not remote.ok:
        detail = remote.error or "unknown error"
        print(
            f"BLOCKED — needs owner: sizes endpoint unreachable ({detail}).\n"
            "DEPLOY_TOKEN is set but the sizes request did not return 200.\n"
            "Do not treat this as an empty remote tree."
        )
        return 1

    build_files = local_build_files(build_path) if build_path.is_dir() else {}
    print(f"\n=== Remote size map for '{PROJECT_NAME}' ({len(remote.files)} files) ===\n")

    overlap: List[Tuple[str, int, Optional[int]]] = []
    orphans: List[Tuple[str, int]] = []
    for rel in sorted(remote.files):
        remote_size = remote.files[rel]
        if rel in build_files:
            overlap.append((rel, remote_size, build_files[rel]))
        else:
            orphans.append((rel, remote_size))

    print(f"(a) also in local {BUILD_DIR}/: {len(overlap)}")
    for rel, remote_size, local_size in overlap:
        marker = "=" if local_size == remote_size else f"local={local_size}"
        print(f"  {remote_size:10d}  {rel}  ({marker})")

    orphan_bytes = sum(size for _, size in orphans)
    print(f"\n(b) remote-only orphans: {len(orphans)}  ({orphan_bytes} bytes)")
    running = 0
    for rel, remote_size in orphans:
        running += remote_size
        print(f"  {remote_size:10d}  {rel}  (orphan total {running})")
    print(f"\nOrphan running total: {orphan_bytes} bytes ({orphan_bytes / (1024 * 1024):.1f} MiB)")

    shadows = directory_index_shadows(remote.files, build_files)
    print(f"\nDirectoryIndex shadow candidates (remote-only root HTML / size {DIRECTORY_INDEX_SHADOW_SIZE}):")
    if shadows:
        for rel in shadows:
            print(f"  {rel}  ({remote.files[rel]} bytes)")
    else:
        print("  (none matched the heuristic — inspect the map above for a 1438-byte root file)")
    return 0


def is_hashed_asset(rel_s: str) -> bool:
    return bool(HASHED_ASSET_RE.match(rel_s))


def should_skip(rel_s: str, local_size: int, skip_sizes: Dict[str, int]) -> bool:
    """Skip only when the remote size matches AND the name is content-addressed."""
    if not is_hashed_asset(rel_s):
        return False
    return skip_sizes.get(rel_s) == local_size


def build_zip(
    build_path: Path,
    skip_sizes=None,
    extra_members: Optional[Dict[str, bytes]] = None,
) -> bytes:
    """Zip the contents of build_path into an in-memory archive."""
    buf = io.BytesIO()
    skip_sizes = skip_sizes or {}
    extra_members = extra_members or {}

    planned: List[Tuple[Path, str, int]] = []
    skipped: List[Tuple[str, int]] = []
    for file in sorted(build_path.rglob("*")):
        if file.is_dir():
            continue
        rel = file.relative_to(build_path)
        parts = rel.parts
        if any(p in (".git", "node_modules", "__pycache__") for p in parts):
            continue
        rel_s = str(rel).replace("\\", "/")
        local_size = file.stat().st_size
        if should_skip(rel_s, local_size, skip_sizes):
            skipped.append((rel_s, local_size))
        else:
            planned.append((file, rel_s, local_size))

    planned_names = {rel_s for _, rel_s, _ in planned}
    local_native = [
        name for name in NATIVE_PAIR if (build_path / name).is_file()
    ]
    native_uploading = [name for name in local_native if name in planned_names]
    native_skipped = [name for name in local_native if name not in planned_names]
    # INVARIANT: glue + wasm (+ pthread worker if present) are one emcc output.
    # Mixing 3.1.x glue with 6.x wasm throws at __embind_register_value_object_field.
    # Never size-check these independently.
    if native_uploading and native_skipped:
        _log(
            f"  ! native pair incomplete ({', '.join(native_uploading)} would upload, "
            f"{', '.join(native_skipped)} would skip) — forcing the whole pair"
        )
        skipped = [(n, s) for n, s in skipped if n not in native_skipped]
        for name in native_skipped:
            path = build_path / name
            planned.append((path, name, path.stat().st_size))

    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for n, local_size in skipped:
            _log(f"  = {n} ({local_size} bytes, hashed asset unchanged)")
        for file, rel_s, local_size in planned:
            zf.write(file, rel_s)
            _log(f"  + {rel_s} ({local_size} bytes)")
        for rel_s, payload in sorted(extra_members.items()):
            zf.writestr(rel_s, payload)
            _log(f"  + {rel_s} (cloned from index.html, {len(payload)} bytes)")
    return buf.getvalue()


def deploy_bundle(build_path: Path, dry_run: bool = False, manifest: bool = False) -> bool:
    """Zip the build and upload it as a single bundle (unless dry_run)."""
    target_folder = DEPLOY_FOLDER or PROJECT_NAME

    _log("Building zip archive...")
    target_folder_for_sizes = globals().get("DEPLOY_FOLDER") or globals().get("TARGET_FOLDER") or PROJECT_NAME
    if "target_folder" in locals() and target_folder:
        target_folder_for_sizes = target_folder
    target_site_for_sizes = globals().get("DEPLOY_TARGET", "test")
    _log("Checking remote file sizes...")
    remote = fetch_remote_sizes(target_folder_for_sizes, target_site_for_sizes)
    skip_sizes = remote.files if remote.ok else {}

    extra_members: Dict[str, bytes] = {}
    index_path = build_path / "index.html"
    if not remote.ok:
        _log(
            "WARNING: sizes endpoint unreachable "
            f"({remote.error or 'unknown'}). Skip set is empty;\n"
            "  this dry-run lists a full upload and does not match an authenticated\n"
            "  run's skip set. DirectoryIndex clones cannot be computed either.\n"
            "  index.html will still upload; the UTF-16 shadow will not be overwritten\n"
            "  until --list-remote succeeds and a deploy re-runs with a size map."
        )
    elif index_path.is_file():
        index_bytes = index_path.read_bytes()
        build_files = local_build_files(build_path)
        shadows = directory_index_shadows(remote.files, build_files)
        for rel in shadows:
            extra_members[rel] = index_bytes
        if not shadows:
            _log("  DirectoryIndex clones: none (heuristic found no remote-only root HTML)")
    else:
        _log("  ! build/index.html missing — cannot clone DirectoryIndex shadows")

    zip_bytes = build_zip(build_path, skip_sizes, extra_members)
    _log(f"Archive size: {len(zip_bytes) / 1024:.1f} KB\n")

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as _zf:
        if not _zf.namelist():
            print("All files identical in size on the target; nothing to upload.")
            return True

    if dry_run or manifest:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = zf.namelist()
            if manifest:
                for name in names:
                    print(f"{name}\t{zf.getinfo(name).file_size}")
                return True
            print(f"Dry run: {len(zip_bytes) / 1024:.1f} KB archive, {len(names)} file(s) that WOULD upload:")
            for name in names:
                info = zf.getinfo(name)
                print(f"  {info.file_size:10d}  {name}")
        print(
            f"\nDry run: would POST to {CONTABO_BASE_URL}/api/deploy/{PROJECT_NAME}/bundle "
            f"(target_folder={target_folder!r}). Stopping before network upload."
        )
        return True

    if not DEPLOY_TOKEN:
        print("ERROR: DEPLOY_TOKEN environment variable is not set.")
        print('Set it via: export DEPLOY_TOKEN="your_long_token_from_vps_env"')
        print("Refusing to deploy without an explicit token (no baked-in default).")
        sys.exit(1)

    url = f"{CONTABO_BASE_URL}/api/deploy/{PROJECT_NAME}/bundle"
    headers = {"X-Deploy-Token": DEPLOY_TOKEN}

    print("Uploading bundle...")
    try:
        response = requests.post(
            url,
            files={"bundle": ("build.zip", zip_bytes, "application/zip")},
            data={"target_folder": target_folder},
            headers=headers,
            timeout=300,
        )
    except Exception as exc:
        print(f"  \u2717 Upload exception: {exc}")
        return False

    if response.status_code == 200:
        data = response.json()
        print(f"  \u2713 {data.get('uploaded', 0)} files uploaded")
        if data.get("failed"):
            print("  Failures:")
            for f in data["failed"]:
                print(f"    \u2717 {f['path']}: {f['error']}")
        return not data.get("failed")
    else:
        print(f"  \u2717 {response.status_code}: {response.text[:400]}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Deploy build/ to storage.noahcohn.com")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build the zip and report its manifest, but stop before uploading.",
    )
    parser.add_argument(
        "--list-remote",
        action="store_true",
        help="Fetch the remote size map, print overlap vs orphans, and exit (no upload).",
    )
    parser.add_argument(
        "--manifest",
        action="store_true",
        help="Print zip members as path<TAB>size (same skip rules as a real deploy) and exit.",
    )
    args = parser.parse_args()

    build_path = Path(BUILD_DIR)
    if args.list_remote:
        print(f"\n=== Remote listing for '{PROJECT_NAME}' ===\n")
        if not DEPLOY_TOKEN:
            sys.exit(list_remote(build_path, RemoteSizesResult({}, ok=False, error="no token")))
        target_folder = DEPLOY_FOLDER or PROJECT_NAME
        target_site = globals().get("DEPLOY_TARGET", "test")
        remote = fetch_remote_sizes(target_folder, target_site)
        sys.exit(list_remote(build_path, remote))

    if not args.manifest:
        print(f"\n=== Deploying '{PROJECT_NAME}' via Contabo -> storage.noahcohn.com ===\n")

    if not build_path.exists() or not build_path.is_dir():
        print(f"ERROR: Build directory '{BUILD_DIR}/' does not exist.")
        print("Please run your build command first (e.g. `npm run build`).")
        sys.exit(1)

    if not args.dry_run and not args.manifest:
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

    if args.manifest:
        global QUIET
        QUIET = True
    success = deploy_bundle(
        build_path,
        dry_run=args.dry_run,
        manifest=args.manifest,
    )

    if args.manifest:
        sys.exit(0 if success else 1)
    if args.dry_run:
        print("\n=== Dry run complete (no upload performed) ===")
    else:
        print(f"\n=== {'Deployment complete' if success else 'Deployment finished with errors'} ===")
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
