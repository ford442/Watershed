
import time
from playwright.sync_api import sync_playwright

def verify_visuals():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=swiftshader', '--ignore-gpu-blocklist']
        )
        page = browser.new_page()

        # Capture console logs
        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))

        page.goto("http://localhost:3000")

        # Wait for "CLICK TO ENGAGE" or loading to finish
        print("Waiting for initial load...")
        time.sleep(30) # Increased wait time significantly

        # Try to click center to start game if loading finished
        width = 800
        height = 600
        if page.viewport_size:
            width = page.viewport_size['width']
            height = page.viewport_size['height']

        print("Clicking center screen...")
        page.mouse.click(width / 2, height / 2)

        # Wait for game start animation
        time.sleep(10)

        page.screenshot(path="verification/verification_gameplay_final.png")
        print("Screenshot saved to verification/verification_gameplay_final.png")

        browser.close()

if __name__ == "__main__":
    verify_visuals()
