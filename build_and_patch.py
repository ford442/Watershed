#!/usr/bin/env python3
"""
build_and_patch.py — build, deploy, and PROVE the deploy.

  python3 build_and_patch.py                 # build -> deploy -> verify
  python3 build_and_patch.py --dry-run       # build -> deploy --dry-run -> verify (still runs)
  python3 build_and_patch.py --skip-verify   # build -> deploy, no verification (discouraged)

Extra args are forwarded to deploy.py (e.g. --incremental, --allow-dirty).

A deploy that cannot be verified exits NON-ZERO. #402 was live for 26 days because
the served bytes had never once been compared to the built bytes; the verify step is
what closes that hole, so it is on by default.
"""

import os
import shlex
import subprocess
import sys

REPO_DIR = '.'
DEPLOY_SCRIPT = os.path.join(REPO_DIR, 'deploy.py')
VERIFY_SCRIPT = os.path.join('verification', 'verify_deploy.mjs')


def run_command(command, cwd=None):
    """Run a command, streaming nothing but reporting its output. Returns success."""
    print(f"Running: {command}")
    result = subprocess.run(command, shell=True, cwd=cwd,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    print(result.stdout)
    if result.returncode != 0:
        print(f"❌ ERROR running '{command}' (exit {result.returncode})")
        return False
    return True


def current_commit():
    try:
        return subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=REPO_DIR,
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return None


def main():
    args = [a for a in sys.argv[1:] if a != '--skip-verify']
    skip_verify = '--skip-verify' in sys.argv[1:]
    dry_run = '--dry-run' in args

    deploy_cmd = "python3 deploy.py"
    if args:
        deploy_cmd += " " + " ".join(shlex.quote(a) for a in args)

    if not run_command("pnpm run build", cwd=REPO_DIR):
        sys.exit(1)

    if not os.path.exists(DEPLOY_SCRIPT):
        print(f"❌ ERROR: {DEPLOY_SCRIPT} not found.")
        sys.exit(1)

    if not run_command(deploy_cmd, cwd=REPO_DIR):
        sys.exit(1)

    if skip_verify:
        print("⚠️  Verification skipped (--skip-verify). "
              "You do NOT know what is live. See docs/reference/DEPLOY.md.")
        sys.exit(0)

    if dry_run:
        print("Dry run: nothing was uploaded, so the live site still reflects the previous "
              "deploy. Running the verifier anyway — a failure here is expected and is "
              "exactly what it should say.")

    verify_cmd = f"node {VERIFY_SCRIPT}"
    commit = current_commit()
    if commit and not dry_run:
        verify_cmd += f" --expect {commit}"

    if not run_command(verify_cmd, cwd=REPO_DIR):
        if dry_run:
            print("(Expected during a dry run — nothing was uploaded.)")
            sys.exit(0)
        print("❌ The deploy could not be verified. The live site is NOT this build.")
        sys.exit(1)

    print("✅ Build deployed and verified live.")


if __name__ == "__main__":
    main()
