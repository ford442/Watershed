
from playwright.sync_api import sync_playwright
import time
import os

def verify_moss():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=swiftshader', '--ignore-gpu-blocklist']
        )
        page = browser.new_page()

        # Capture console logs
        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))

        try:
            print("Navigating to app...")
            page.goto("http://localhost:8000")

            # Wait for canvas
            page.wait_for_selector("canvas", timeout=30000)
            print("Canvas found.")

            # Wait for loading to finish (Button text changes)
            print("Waiting for loading to finish...")
            # The button text should contain "CLICK TO ENGAGE"
            start_button = page.locator(".start-button")

            # Wait up to 60 seconds for loading
            expect_text = "CLICK TO ENGAGE"
            for i in range(60):
                text = start_button.inner_text()
                if "CLICK TO ENGAGE" in text:
                    print("Loading complete.")
                    break
                print(f"Still loading... Button text: {text}")
                time.sleep(1)
            else:
                print("Timed out waiting for loading.")
                # Take debug screenshot
                page.screenshot(path="/home/jules/verification/timeout_loading.png")
                return

            # Click the start button
            print("Clicking start button...")
            start_button.click()

            # Wait for transition
            time.sleep(5)

            # Take screenshot of the game
            os.makedirs("/home/jules/verification", exist_ok=True)
            output_path = "/home/jules/verification/moss_verification.png"
            page.screenshot(path=output_path)
            print(f"Captured {output_path}")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="/home/jules/verification/error_script.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_moss()
