
from playwright.sync_api import sync_playwright
import time

def verify_visuals():
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

        # Navigate to the app
        print("Navigating to app...")
        page.goto("http://localhost:3000")

        # Wait for canvas to load
        print("Waiting for canvas...")
        try:
            page.wait_for_selector("canvas", timeout=60000)
            print("Canvas found.")
        except Exception as e:
            print(f"Error waiting for canvas: {e}")

        # Wait for "CLICK TO ENGAGE" or similar start screen text
        print("Waiting for start screen...")
        time.sleep(10) # Give it time to load assets (shaders compilation etc)

        # Take screenshot of the start screen (should show river background)
        print("Taking screenshot...")
        page.screenshot(path="verification/verification_visuals.png")

        # Try to start the game to see the river more clearly
        # Simulate click on center of screen
        print("Clicking to start...")
        page.mouse.click(400, 300)

        time.sleep(2)
        page.keyboard.press("Enter") # Try enter key if click doesn't work

        time.sleep(5) # Wait for transition

        print("Taking in-game screenshot...")
        page.screenshot(path="verification/verification_visuals_ingame.png")

        browser.close()
        print("Done.")

if __name__ == "__main__":
    verify_visuals()
