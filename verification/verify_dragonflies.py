from playwright.sync_api import sync_playwright, expect
import time
import os

def verify_dragonflies():
    # Ensure verification directory exists
    os.makedirs("verification", exist_ok=True)

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
        try:
            page.goto("http://localhost:3000", timeout=60000)
        except Exception as e:
            print(f"Navigation failed: {e}")
            return

        # Wait for canvas to load
        print("Waiting for canvas...")
        try:
            page.wait_for_selector("canvas", timeout=60000)
            print("Canvas found.")
        except Exception as e:
            print(f"Error waiting for canvas: {e}")
            page.screenshot(path="verification/error_canvas.png")
            return

        # Wait for start button to be clickable
        print("Waiting for start button...")
        try:
            # Look for button with class 'start-button'
            start_button = page.locator(".start-button")
            start_button.wait_for(state="visible", timeout=60000)

            # Take screenshot of start screen
            print("Taking start screen screenshot...")
            page.screenshot(path="verification/start_screen.png")

            # Click start
            print("Clicking start...")
            start_button.click()

        except Exception as e:
            print(f"Error interacting with start button: {e}")
            page.screenshot(path="verification/error_start.png")
            return

        # Wait for game to transition (it takes a few seconds)
        print("Waiting for game transition...")
        time.sleep(10)

        # Take in-game screenshot
        # We hope to see dragonflies!
        print("Taking in-game screenshot...")
        page.screenshot(path="verification/ingame_dragonflies.png")

        browser.close()
        print("Done.")

if __name__ == "__main__":
    verify_dragonflies()
