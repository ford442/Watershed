from playwright.sync_api import sync_playwright
import time
import os

def verify_visuals():
    os.makedirs("verification", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-gl=swiftshader",
                "--ignore-gpu-blocklist",
                "--allow-file-access-from-files",
                "--enable-webgl",
            ]
        )
        page = browser.new_page()
        page.goto("http://localhost:3000")

        try:
            print("Waiting for canvas...")
            page.wait_for_selector("canvas", timeout=90000)

            # Look for the start button class .start-button (as per memory)
            print("Waiting for start button...")
            start_btn = page.wait_for_selector(".start-button", timeout=30000)
            if start_btn:
                print("Clicking start button...")
                start_btn.click()
            else:
                print("Start button not found via selector, trying coordinates...")
                page.mouse.click(window_width/2, window_height/2)

            print("Waiting for game to load...")
            time.sleep(20) # Wait for assets and generation

            print("Taking screenshot...")
            page.screenshot(path="verification/rock_foam.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")

        finally:
            browser.close()

if __name__ == "__main__":
    verify_visuals()
