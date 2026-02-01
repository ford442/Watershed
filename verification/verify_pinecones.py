from playwright.sync_api import sync_playwright
import time
import os

def verify_pinecones():
    with sync_playwright() as p:
        print("Launching browser...")
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--ignore-gpu-blocklist",
                "--enable-webgl"
            ]
        )
        page = browser.new_page()

        print("Navigating to localhost:3000...")
        try:
            page.goto("http://localhost:3000", timeout=60000)
        except Exception as e:
            print(f"Navigation failed: {e}")
            return

        print("Waiting for .start-button...")
        try:
            # Wait for the start button to appear (indicates loading done)
            page.wait_for_selector(".start-button", timeout=90000)
            print("Start button found. Clicking...")
            page.click(".start-button")
        except Exception as e:
            print(f"Start button not found or timeout: {e}")
            # Take a screenshot anyway to see what happened (maybe stuck loading)
            page.screenshot(path="verification/verification_error.png")
            return

        print("Waiting for game loop to start...")
        time.sleep(10) # Wait for camera to settle and assets to render

        print("Taking screenshot of riverbank...")
        page.screenshot(path="verification/verification_pinecones.png")

        browser.close()
        print("Verification complete.")

if __name__ == "__main__":
    verify_pinecones()
