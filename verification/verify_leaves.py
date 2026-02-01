from playwright.sync_api import Page, expect, sync_playwright
import time

def test_scene_leaves(page: Page):
    print("Navigating to app...")
    page.goto("http://localhost:3000")

    print("Waiting for Start Button...")
    start_button = page.locator(".start-button")
    expect(start_button).to_be_visible(timeout=30000)

    print("Clicking Start...")
    start_button.click()

    # Wait for the scene to become active (loader hidden)
    print("Waiting for Loader to disappear...")
    loader = page.locator(".loader-overlay")
    expect(loader).not_to_be_visible(timeout=60000)

    print("Waiting for simulation (leaves falling)...")
    # Wait for leaves to fall and drift
    time.sleep(10)

    print("Taking Screenshot...")
    page.screenshot(path="verification/verification.png")
    print("Screenshot saved.")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_scene_leaves(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()
