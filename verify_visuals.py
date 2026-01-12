
from playwright.sync_api import sync_playwright
import time

def verify_visuals():
    with sync_playwright() as p:
        # Launch Chromium with SwiftShader enabled for software WebGL rendering
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=swiftshader', '--ignore-gpu-blocklist']
        )
        context = browser.new_context()
        page = context.new_page()

        print("Navigating to application...")
        # Use http://localhost:3000 assuming the build is served there
        page.goto("http://localhost:3000")

        # Wait for the canvas to load.
        # The game usually has a "Click to Start" or loading screen.
        print("Waiting for canvas...")
        try:
            page.wait_for_selector('canvas', timeout=30000)
            print("Canvas found.")
        except Exception as e:
            print("Canvas not found:", e)
            page.screenshot(path="verification_error.png")
            browser.close()
            return

        # Wait a bit for the 3D scene to initialize/render
        # Since we are checking visuals (water, reflections), we need the scene to be active.
        # Often there is a "Click to Engage" overlay.

        # Check for start button/overlay
        try:
            # Look for common start indicators based on memory/context
            start_overlay = page.locator('text=CLICK TO ENGAGE')
            if start_overlay.is_visible():
                print("Clicking start overlay...")
                start_overlay.click()
                # Wait for transition
                time.sleep(2)
        except:
            print("No start overlay found, assuming auto-start or different flow.")

        # Allow time for shaders and environment to compile/render
        print("Waiting for scene to render...")
        time.sleep(10)

        # Take a screenshot
        screenshot_path = "verification_visuals.png"
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        browser.close()

if __name__ == "__main__":
    verify_visuals()
