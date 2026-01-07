
from playwright.sync_api import sync_playwright
import time

def verify_visuals():
    with sync_playwright() as p:
        # Launch Chromium with software rendering enabled
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=swiftshader', '--ignore-gpu-blocklist']
        )
        page = browser.new_page()

        try:
            # Go to the app
            page.goto("http://localhost:3000")

            # Wait for canvas to load
            page.wait_for_selector("canvas", timeout=60000)

            # Click to engage pointer lock / start game
            # This is crucial as the game might be in a 'Click to Start' state
            page.click("canvas", position={"x": 300, "y": 300})

            # Wait a bit for everything to settle
            time.sleep(5)

            # Take screenshot of the "Summer" state (start of game)
            page.screenshot(path="/home/jules/verification/summer_start.png")
            print("Captured summer_start.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_visuals()
