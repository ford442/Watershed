from playwright.sync_api import sync_playwright

def verify_visuals():
    with sync_playwright() as p:
        # Launch Chromium with software rendering support for WebGL in headless environment
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=swiftshader', '--ignore-gpu-blocklist']
        )
        page = browser.new_page()

        # Navigate to the served build
        page.goto('http://localhost:8080')

        # Wait for canvas to be present
        page.wait_for_selector('canvas')

        # Wait for the Start overlay
        page.wait_for_selector('text=CLICK TO ENGAGE', timeout=10000)

        # Click the overlay container instead of canvas (since canvas is obscured)
        # Or try to force click canvas, or press Enter

        # Trying to click the "CLICK TO ENGAGE" text directly or just press enter
        page.click('text=CLICK TO ENGAGE')

        # Also press Enter just in case, as per instructions
        page.keyboard.press('Enter')

        # Wait for game to start (overlay should disappear or change)
        # We can wait for the overlay to disappear
        # page.wait_for_selector('text=CLICK TO ENGAGE', state='hidden', timeout=10000)

        # Wait a bit for the scene/terrain to load
        page.wait_for_timeout(5000)

        # Take a screenshot of the gameplay view
        page.screenshot(path='verification/gameplay_visuals.png')

        browser.close()

if __name__ == "__main__":
    verify_visuals()
