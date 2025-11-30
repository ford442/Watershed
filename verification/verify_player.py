import time
from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            print("Navigating to http://localhost:3000")
            page.goto("http://localhost:3000")

            # Wait for canvas to appear
            print("Waiting for canvas...")
            page.wait_for_selector("canvas", timeout=60000)
            print("Canvas found.")

            # Allow time for Three.js/Rapier to initialize and render
            print("Waiting for scene to render...")
            time.sleep(15)

            # Take a screenshot
            screenshot_path = "verification/player_view.png"
            page.screenshot(path=screenshot_path)
            print(f"Screenshot saved to {screenshot_path}")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
