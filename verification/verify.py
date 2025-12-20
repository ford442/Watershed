from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            print("Navigating...")
            # Retry connection
            for i in range(10):
                try:
                    page.goto("http://localhost:3000")
                    break
                except:
                    print(f"Retrying connection {i+1}...")
                    time.sleep(2)

            # Wait for Loader
            print("Waiting for loader...")
            loader = page.locator(".loader-overlay")
            loader.wait_for(state="visible", timeout=60000)

            # Screenshot loading state
            page.screenshot(path="verification/loading.png")
            print("Screenshot taken: loading.png")

            # Check button state
            button = page.locator("button.start-button")
            button.wait_for(state="attached")

            is_disabled = button.is_disabled()
            print(f"Button disabled: {is_disabled}")
            text = button.text_content()
            print(f"Button text: {text}")

            if not (is_disabled and "LOADING" in text):
                print("FAILURE: Button state incorrect during loading.")
                return

            print("SUCCESS: Button is disabled and shows loading text.")

            # Wait for loader to disappear (fade out)
            print("Waiting for loader to disappear...")
            loader.wait_for(state="hidden", timeout=30000)

            # Check button state again
            is_disabled = button.is_disabled()
            text = button.text_content()
            print(f"Button disabled: {is_disabled}")
            print(f"Button text: {text}")

            if not is_disabled and "CLICK TO ENGAGE" in text:
                print("SUCCESS: Button is enabled and shows start text.")
            else:
                 print("FAILURE: Button state incorrect after loading.")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
