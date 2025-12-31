
from playwright.sync_api import sync_playwright

def verify_pause_control():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the built application
        # Since we ran 'pnpm build', we can serve the build folder or just open index.html if it works
        # But for React apps with routing/assets, serving is better.
        # We'll assume simple file opening might work if paths are relative, or use a simple server.

        # Let's try to start a simple server in background
        import subprocess
        import time

        # Start python server on 3000
        server = subprocess.Popen(['python3', '-m', 'http.server', '3000', '--directory', 'build'])
        time.sleep(2) # Wait for server

        try:
            page.goto('http://localhost:3000')

            # Wait for the UI to load (the 'WATERSHED' title)
            page.wait_for_selector('h1:has-text("WATERSHED")')

            # Verify the Pause Control exists
            pause_control = page.locator('.control-row[aria-label="Pause: Escape key"]')

            if pause_control.count() > 0:
                print('Pause control found!')
                # Take screenshot
                page.screenshot(path='verification/pause_control.png')
            else:
                print('Pause control NOT found!')

        finally:
            server.terminate()
            browser.close()

if __name__ == '__main__':
    verify_pause_control()
