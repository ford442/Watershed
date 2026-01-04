from playwright.sync_api import sync_playwright

def verify_visuals():
    with sync_playwright() as p:
        # Launch with swiftshader for software WebGL to help with headless rendering
        browser = p.chromium.launch(headless=True, args=['--use-gl=swiftshader', '--ignore-gpu-blocklist'])
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()

        # Capture logs
        page.on("console", lambda msg: print(f"Console: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"PageError: {exc}"))

        print("Navigating...")
        page.goto("http://localhost:8080")

        try:
            # Wait for canvas (R3F root)
            page.wait_for_selector("canvas", timeout=30000)
            print("Canvas found.")

            # Click center to ensure focus / dismiss any "Click to Start" overlay
            page.mouse.click(640, 360)
            page.wait_for_timeout(2000)

            # Press Enter to start game (common pattern in this project)
            print("Pressing Enter...")
            page.keyboard.press("Enter")

            # Wait for game to start/transition
            page.wait_for_timeout(5000)

            # Press 'W' briefly to move camera (might reveal grass if obstructed)
            page.keyboard.down("w")
            page.wait_for_timeout(500)
            page.keyboard.up("w")

            # Take screenshot
            page.screenshot(path="verification_grass_2.png")
            print("Screenshot taken: verification_grass_2.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification_error_2.png")

        browser.close()

if __name__ == "__main__":
    verify_visuals()
