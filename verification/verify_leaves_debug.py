from playwright.sync_api import Page, expect, sync_playwright
import time

def test_scene_leaves(page: Page):
    # Capture console logs
    page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))
    page.on("pageerror", lambda exc: print(f"Browser Error: {exc}"))

    print("Navigating to app...")
    page.goto("http://localhost:3000")

    print("Waiting for Start Button...")
    start_button = page.locator(".start-button")
    expect(start_button).to_be_visible(timeout=60000)

    print("Clicking Start...")
    start_button.click()

    # Wait for the scene to become active (loader hidden)
    print("Waiting for Loader to disappear...")
    loader = page.locator(".loader-overlay")
    expect(loader).not_to_be_visible(timeout=90000)

    print("Waiting for simulation (leaves falling)...")
    # Wait longer for heavy assets in headless mode
    time.sleep(20)

    print("Taking Screenshot...")
    page.screenshot(path="verification/verification_debug.png")
    print("Screenshot saved.")

if __name__ == "__main__":
    with sync_playwright() as p:
        # Enable WebGL software rendering if needed, or just standard args
        browser = p.chromium.launch(headless=True, args=["--use-gl=swiftshader"])
        page = browser.new_page()
        try:
            test_scene_leaves(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error_debug.png")
        finally:
            browser.close()
