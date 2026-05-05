from playwright.sync_api import sync_playwright
import time

def verify_visuals():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Navigating to app...")
        page.goto("http://localhost:3000")

        # Wait for loader to finish (start button becomes enabled/visible)
        # The loader might take a while for assets
        print("Waiting for assets to load...")
        try:
            # Wait for the start button to be present and not disabled
            # It starts disabled while loading
            page.wait_for_selector(".start-button:not([disabled])", timeout=60000)
            print("Assets loaded. Start button is ready.")
        except Exception as e:
            print(f"Timeout waiting for load: {e}")
            page.screenshot(path="verification_timeout.png")
            browser.close()
            return

        # Hide the UI overlay to see the 3D scene clearly
        print("Hiding UI overlay...")
        page.evaluate("document.querySelector('.ui-overlay').style.display = 'none'")

        # Wait a bit for any frames to render/settle
        time.sleep(2)

        # Take screenshot
        print("Taking screenshot...")
        page.screenshot(path="verification_visuals.png")
        print("Screenshot saved to verification_visuals.png")

        browser.close()

if __name__ == "__main__":
    verify_visuals()
