import subprocess
import os

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
    if not run_command("pnpm run build", cwd=WEBGPU_TS_DIR):
        return
    if os.path.exists(DEPLOY_SCRIPT):
        if not run_command("python3 deploy.py", cwd=WEBGPU_TS_DIR):
            return
    else:
        print(f"❌ ERROR: {DEPLOY_SCRIPT} not found.")

if __name__ == "__main__":
    main()
