
from playwright.sync_api import sync_playwright
import os
import time

OUT_DIR = os.path.join(os.path.dirname(__file__), 'output')

def verify_visuals():
    os.makedirs(OUT_DIR, exist_ok=True)
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

        # Log console messages
        def handle_console(msg):
            print(f"Console [{msg.type}]: {msg.text}")
        page.on("console", handle_console)

        # Navigate to the app
        print("Navigating to app...")
        page.goto("http://localhost:3000?no-pointer-lock")

        # Debug screenshot immediately after load
        page.screenshot(path=os.path.join(OUT_DIR, "debug_page.png"))
        print("Debug page screenshot saved.")

        # Wait for UI overlay first
        print("Waiting for UI...")
        try:
            page.wait_for_selector(".ui-overlay", timeout=30000)
            print("UI found.")
        except:
            print("UI not found, continuing.")

        # Wait for canvas to load
        print("Waiting for canvas...")
        try:
            page.wait_for_selector("canvas", timeout=60000)
            print("Canvas found.")
        except Exception as e:
            print(f"Error waiting for canvas: {e}")

        # Wait for "CLICK TO ENGAGE" or similar start screen text
        print("Waiting for start screen...")
        time.sleep(30) # Give it time to load assets (shaders compilation etc)

        # Take screenshot of the start screen (should show river background)
        print("Taking screenshot...")
        page.screenshot(path=os.path.join(OUT_DIR, "verification_visuals.png"))

        # Try to start the game to see the river more clearly
        # Simulate click on center of screen
        print("Clicking to start...")
        page.mouse.click(400, 300)

        time.sleep(2)
        page.keyboard.press("Enter") # Try enter key if click doesn't work

        time.sleep(30) # Wait for transition

        print("Taking in-game screenshot...")
        page.screenshot(path=os.path.join(OUT_DIR, "verification_visuals_ingame.png"))

        browser.close()
        print(f"Done. Screenshots saved to {OUT_DIR}/")

if __name__ == "__main__":
    verify_visuals()
