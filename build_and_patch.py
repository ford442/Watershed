#!/usr/bin/env python3
"""Build and deploy Watershed: `pnpm build:full`, then `deploy.py`.

Every step streams its output as it runs (Vite / tsc / emcc errors land in the
terminal, not in a buffer), and the first failing step ends this script with a
non-zero exit code, so a caller or CI can tell a failed release from a good one.

Usage:
    python3 build_and_patch.py              # build, then upload
    python3 build_and_patch.py --dry-run    # extra args go straight to deploy.py
"""
import os
import shlex
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DEPLOY_SCRIPT = os.path.join(ROOT, 'deploy.py')


def run_step(argv):
    """Run one step with inherited stdio; exit with its code if it fails."""
    print(f"Running: {shlex.join(argv)}", flush=True)
    try:
        code = subprocess.run(argv, cwd=ROOT).returncode
    except OSError as error:
        print(f"❌ ERROR: could not start '{argv[0]}': {error}", file=sys.stderr)
        sys.exit(1)
    if code != 0:
        print(f"❌ ERROR: '{shlex.join(argv)}' exited with {code}", file=sys.stderr)
        sys.exit(code)


def main():
    # Forward any extra CLI args (e.g. --dry-run) straight through to deploy.py so
    # the full build -> package path can be exercised without a real upload.
    deploy_args = sys.argv[1:]

    run_step(['pnpm', 'run', 'build:full'])
    if not os.path.exists(DEPLOY_SCRIPT):
        print(f"❌ ERROR: {DEPLOY_SCRIPT} not found.", file=sys.stderr)
        sys.exit(1)
    run_step([sys.executable, DEPLOY_SCRIPT, *deploy_args])


if __name__ == "__main__":
    main()
