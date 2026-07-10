import subprocess
import os
import sys
import shlex

WEBGPU_TS_DIR = '.'
DEPLOY_SCRIPT = os.path.join(WEBGPU_TS_DIR, 'deploy.py')

def run_command(command, cwd=None):
    print(f"Running: {command}")
    result = subprocess.run(command, shell=True, cwd=cwd,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        print(f"❌ ERROR running '{command}':\n{result.stderr}")
        return False
    print(result.stdout)
    return True

def main():
    # Forward any extra CLI args (e.g. --dry-run) straight through to deploy.py so
    # the full build -> package path can be exercised without a real upload.
    deploy_args = sys.argv[1:]
    deploy_cmd = "python3 deploy.py"
    if deploy_args:
        deploy_cmd += " " + " ".join(shlex.quote(a) for a in deploy_args)

    if not run_command("pnpm run build", cwd=WEBGPU_TS_DIR):
        return
    if os.path.exists(DEPLOY_SCRIPT):
        if not run_command(deploy_cmd, cwd=WEBGPU_TS_DIR):
            return
    else:
        print(f"❌ ERROR: {DEPLOY_SCRIPT} not found.")

if __name__ == "__main__":
    main()
