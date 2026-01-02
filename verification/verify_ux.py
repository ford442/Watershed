from playwright.sync_api import sync_playwright

def verify_ux_changes():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # We need to serve the build folder
        # Assuming the build is already done and server is running at port 8000
        page.goto("http://localhost:8000")

        # Wait for loader to finish or at least show content
        try:
            page.wait_for_selector(".ui-card", timeout=10000)

            # The start button text should change.
            # Initial state: "CLICK TO ENGAGE / PRESS ENTER"
            # We want to see the RESUME button which appears after starting.
            # But "Start" requires pointer lock which is tricky in headless.
            # However, we can inspect the DOM or just look at the initial UI.

            # The Resume button is only visible if hasStarted is true.
            # We can mock hasStarted by triggering the pointerlockchange event manually in evaluate.

            # Take screenshot of Initial State
            page.screenshot(path="verification/initial_state.png")
            print("Initial state screenshot taken.")

            # Now let's try to simulate 'hasStarted' to see the Resume button
            page.evaluate("""
                // Dispatch a pointer lock event to simulate start
                // The UI component listens to 'pointerlockchange'
                // We need to trick it.
                // But the component checks document.pointerLockElement.

                // We can't easily mock document.pointerLockElement in the browser context from here
                // without proxying the whole document object which might break things.

                // However, we can try to force the state if we could access React state, but we can't.

                // Alternative: The restart button is also hidden.

                // Let's rely on the fact that I modified the Start button text too?
                // No, I only modified the "RESUME" text and "RESTART" text.
                // "CLICK TO ENGAGE / PRESS ENTER" was NOT modified.

                // So I MUST get into the started state to verify my changes.
            """)

            # To simulate started state in a real browser environment without user gesture...
            # The UI component sets 'hasStarted' to true when pointerLockElement becomes truthy.

            # Let's try to mock pointerLockElement in the page
            page.evaluate("""
                Object.defineProperty(document, 'pointerLockElement', {
                    get: () => document.body,
                    configurable: true
                });
                document.dispatchEvent(new Event('pointerlockchange'));
            """)

            # Wait a bit for React to update
            page.wait_for_timeout(500)

            # Now we should see "GAME PAUSED" and "RESUME GAME"
            # But wait, if pointerLockElement is truthy, 'locked' becomes true.
            # If 'locked' is true, the UI overlay is HIDDEN!
            # <div className={`ui-overlay ${!locked ? 'visible' : 'hidden'}`}

            # We want 'hasStarted' to be true, but 'locked' to be false (Paused).
            # So we need to:
            # 1. Lock (sets hasStarted = true)
            # 2. Unlock (sets locked = false, but hasStarted remains true)

            page.evaluate("""
                // Unlock
                Object.defineProperty(document, 'pointerLockElement', {
                    get: () => null,
                    configurable: true
                });
                document.dispatchEvent(new Event('pointerlockchange'));
            """)

            page.wait_for_timeout(500)

            # Now we should see "RESUME GAME" with the key hint
            page.screenshot(path="verification/resume_state.png")
            print("Resume state screenshot taken.")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")

        finally:
            browser.close()

if __name__ == "__main__":
    verify_ux_changes()
