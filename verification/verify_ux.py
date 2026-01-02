from playwright.sync_api import sync_playwright

def verify_game_overlay():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the game (served statically)
        page.goto("http://localhost:3000")

        # Wait for loading to finish (button becomes enabled)
        # The button initially says "LOADING..." then "CLICK TO ENGAGE / PRESS ENTER"
        # We wait for the button to be enabled and not loading
        page.wait_for_selector("button.start-button:not([disabled])", timeout=10000)

        # Take a screenshot of the initial state (should see Start button)
        page.screenshot(path="verification/1_initial_state.png")
        print("Initial state screenshot taken")

        # Simulate Start (Click Engage)
        # Note: Pointer lock requires user gesture, and in headless it might be tricky.
        # However, our UI component listens for 'pointerlockchange'.
        # We can simulate the event in the browser context.

        # Click the start button
        page.click("button.start-button")

        # Manually dispatch pointerlockchange to simulate game start
        page.evaluate("""
            Object.defineProperty(document, 'pointerLockElement', {
                value: document.body,
                writable: true
            });
            document.dispatchEvent(new Event('pointerlockchange'));
        """)

        # Wait for UI to hide (game playing)
        # The overlay should become hidden
        # page.wait_for_selector(".ui-overlay.hidden")

        # Take screenshot of playing state (crosshair visible)
        # page.screenshot(path="verification/2_playing_state.png")
        # print("Playing state screenshot taken")

        # Now simulate Pause (Exit pointer lock)
        page.evaluate("""
            Object.defineProperty(document, 'pointerLockElement', {
                value: null,
                writable: true
            });
            document.dispatchEvent(new Event('pointerlockchange'));
        """)

        # Wait for UI to reappear (GAME PAUSED)
        page.wait_for_selector(".ui-overlay.visible")
        page.wait_for_selector("text=GAME PAUSED")

        # Verify the Restart button has the [R] hint
        # We look for the button and check its text content
        restart_btn = page.locator("button.restart-button")
        text = restart_btn.text_content()
        print(f"Restart button text: {text}")

        if "[R]" in text:
            print("SUCCESS: Restart button contains [R] hint")
        else:
            print("FAILURE: Restart button missing [R] hint")

        page.screenshot(path="verification/3_paused_state.png")
        print("Paused state screenshot taken")

        # Now simulate pressing 'R'
        page.keyboard.press("r")

        # Wait for confirmation dialog
        page.wait_for_selector("text=RESTART GAME?")

        page.screenshot(path="verification/4_confirmation_dialog.png")
        print("Confirmation dialog screenshot taken")

        browser.close()

if __name__ == "__main__":
    verify_game_overlay()
