
from playwright.sync_api import sync_playwright
import os
import time

OUT_DIR = os.path.join(os.path.dirname(__file__), 'output')

def verify_moss():
    os.makedirs(OUT_DIR, exist_ok=True)
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
            page.goto("http://localhost:3000")

            # Wait for canvas
            page.wait_for_selector("canvas", timeout=30000)
            print("Canvas found.")

            # Wait for loading to finish (Button text changes)
            print("Waiting for loading to finish...")
            start_button = page.locator(".start-button")

            for i in range(60):
                text = start_button.inner_text()
                if "CLICK TO ENGAGE" in text:
                    print("Loading complete.")
                    break
                print(f"Still loading... Button text: {text}")
                time.sleep(1)
            else:
                print("Timed out waiting for loading.")
                page.screenshot(path=os.path.join(OUT_DIR, "timeout_loading.png"))
                return

            print("Clicking start button...")
            start_button.click()
            time.sleep(5)

            output_path = os.path.join(OUT_DIR, "moss_verification.png")
            page.screenshot(path=output_path)
            print(f"Captured {output_path}")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path=os.path.join(OUT_DIR, "error_script.png"))
        finally:
            browser.close()

if __name__ == "__main__":
    verify_moss()
