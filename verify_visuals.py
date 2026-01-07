from playwright.sync_api import sync_playwright, expect

def verify_environment():
    print("Starting verification script...")
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--use-gl=swiftshader", "--ignore-gpu-blocklist"]
        )
        page = browser.new_page()
        page.set_viewport_size({"width": 1280, "height": 720})
        page.set_default_timeout(60000)

        # Inject mock for pointer lock
        page.add_init_script("""
            window.HTMLElement.prototype.requestPointerLock = function() {
                console.log("Mock requestPointerLock called");
                setTimeout(() => {
                    Object.defineProperty(document, 'pointerLockElement', {
                        get: () => document.body,
                        configurable: true
                    });
                    document.dispatchEvent(new Event('pointerlockchange'));
                }, 100);
            };
            document.exitPointerLock = function() {
                console.log("Mock exitPointerLock called");
                Object.defineProperty(document, 'pointerLockElement', {
                    get: () => null,
                    configurable: true
                });
                document.dispatchEvent(new Event('pointerlockchange'));
            };
        """)

        page.on("console", lambda msg: print(f"Browser console: {msg.text}"))
        page.on("pageerror", lambda err: print(f"Page Error: {err}"))

        print("Navigating to app...")
        page.goto("http://localhost:3000")

        print("Waiting for start screen...")
        try:
            expect(page.get_by_text("WATERSHED")).to_be_visible(timeout=10000)
        except Exception as e:
            print(f"Start screen not found: {e}")

        print("Engaging game...")
        # First try Enter as it's cleaner
        page.keyboard.press("Enter")

        # Also try clicking if Enter isn't enough (redundancy)
        try:
             page.get_by_text("CLICK TO ENGAGE", exact=False).click(timeout=2000)
        except:
             print("Click failed or not found, hoping Enter worked.")

        print("Waiting for scene to load...")
        page.wait_for_timeout(5000)

        print("Taking screenshot...")
        page.screenshot(path="verification_visuals_final.png")

        browser.close()
        print("Done.")

if __name__ == "__main__":
    verify_environment()
