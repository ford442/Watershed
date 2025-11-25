import subprocess
import sys
import os

# Ensure paramiko is installed
try:
    import paramiko
except ImportError:
    print("Paramiko not found. Installing...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "paramiko"])
    import paramiko

WEBGPU_TS_DIR = '/workspaces/webgpu-ts'
HTML_FILE_PATH = os.path.join(WEBGPU_TS_DIR, 'build', 'index.html')
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

def patch_html(html_file_path):
    print(f"Attempting to patch {html_file_path}...")
    if not os.path.exists(html_file_path):
        print(f"❌ ERROR: File not found at {html_file_path}. Did 'npm run build' complete successfully?")
        return False
    try:
        with open(html_file_path, 'r', encoding='utf-8') as file:
            content = file.read()
        content = content.replace('src="/', 'src="./')
        content = content.replace('href="/', 'href="./')
        with open(html_file_path, 'w', encoding='utf-8') as file:
            file.write(content)
        print("✅ Successfully updated paths in index.html to be relative.")
        return True
    except Exception as e:
        print(f"❌ An error occurred during patching: {e}")
        return False

def main():
    if not run_command("git pull", cwd=WEBGPU_TS_DIR):
        return
    if not run_command("npm run build", cwd=WEBGPU_TS_DIR):
        return
    patch_html(HTML_FILE_PATH)
    if os.path.exists(DEPLOY_SCRIPT):
        if not run_command("python3 deploy.py", cwd=WEBGPU_TS_DIR):
            return
    else:
        print(f"❌ ERROR: {DEPLOY_SCRIPT} not found.")

if __name__ == "__main__":
    main()
