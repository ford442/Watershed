
from playwright.sync_api import sync_playwright
import time

def verify_visuals():
    with sync_playwright() as p:
        # Launch with SwiftShader to support WebGL in headless environment
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=swiftshader', '--ignore-gpu-blocklist']
        )
        context = browser.new_context()
        page = context.new_page()

        # Build has been created at build/
        # Use a simple http server to serve the build directory
        # We need to run the server in background, but python script controls execution.
        # So we assume the server is running on port 8080 (I'll start it in a moment)

        try:
            page.goto('http://localhost:8080')

            # Wait for canvas to be present
            page.wait_for_selector('canvas', timeout=10000)

            # Simulate click to engage if needed, or just wait for load
            # The game might need a click to start
            # Check for 'CLICK TO ENGAGE' text
            try:
                page.get_by_text('CLICK TO ENGAGE').click(timeout=5000)
            except:
                print('No click to engage found or timed out')

            # Wait a bit for the scene to render and shader time to pass
            time.sleep(5)

            # Take screenshot
            page.screenshot(path='verification/visuals.png')
            print('Screenshot taken')
        except Exception as e:
            print(f'Error: {e}')
        finally:
            browser.close()

if __name__ == '__main__':
    verify_visuals()
