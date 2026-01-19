
from playwright.sync_api import sync_playwright
import time

def verify_pebbles():
    with sync_playwright() as p:
        # Launch Chromium with WebGL support (software rendering via SwiftShader)
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--ignore-gpu-blocklist",
                "--allow-file-access-from-files",
                "--enable-webgl",
                "--enable-features=WebGPU"
            ]
        )
        page = browser.new_page()

        # Navigate to the app with long timeout
        print("Navigating to app...")
        try:
            page.goto("http://localhost:3000", timeout=90000)
        except Exception as e:
            print(f"Navigation error (ignoring if loaded): {e}")

        # Wait for canvas to load
        print("Waiting for canvas...")
        try:
            page.wait_for_selector("canvas", timeout=60000)
            print("Canvas found.")
        except Exception as e:
            print(f"Error waiting for canvas: {e}")
            page.screenshot(path="verification/error_state.png")
            return

        # Give it time to load assets (shaders compilation etc)
        print("Waiting for assets to load (20s)...")
        time.sleep(20)

        # Take screenshot of the start screen (should show river background)
        print("Taking screenshot...")
        page.screenshot(path="verification/pebbles_verification.png")

        browser.close()
        print("Done.")

if __name__ == "__main__":
    verify_pebbles()
