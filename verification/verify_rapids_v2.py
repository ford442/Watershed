from playwright.sync_api import sync_playwright
import time

def verify_rapids():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            print("Navigating to app...")
            page.goto("http://localhost:3000", timeout=60000)

            print("Waiting for start button...")
            # Use class selector instead of ID
            start_button = page.locator(".start-button")
            start_button.wait_for(state="visible", timeout=60000)

            print("Clicking start button...")
            start_button.click()

            print("Waiting for scene to stabilize (extended wait)...")
            time.sleep(40) # Wait longer for SwiftShader

            print("Taking screenshot...")
            page.screenshot(path="verification/rapids_verification_v2.png")
            print("Screenshot saved.")

        except Exception as e:
            print(f"Error: {e}")
            try:
                page.screenshot(path="verification/error_state_v2.png")
            except:
                pass
        finally:
            browser.close()

if __name__ == "__main__":
    verify_rapids()
