
from playwright.sync_api import sync_playwright

def verify_ui_changes():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app (assuming it's running on port 3000)
        page.goto('http://localhost:3000')

        # Wait for the loader to finish (simulate wait)
        page.wait_for_timeout(3000)

        # 1. Verify Start Button text and structure
        start_btn = page.get_by_role('button', name='Start Game')

        # 2. Check for GAME PAUSED status (it shouldn't be there yet)
        if page.query_selector('.loader-text[role="status"]'):
             print('Unexpected GAME PAUSED status on load')

        # Take screenshot of Initial State
        page.screenshot(path='verification/initial_state.png')

        # 3. Simulate Game Start (click Start)
        # Note: Pointer lock might fail in headless, but the UI state update should happen
        try:
            start_btn.click()
            page.wait_for_timeout(1000)
        except Exception as e:
            print(f'Start click failed: {e}')

        # 4. Simulate Pause (Press Escape)
        # We need to manually dispatch the lock change because headless browsers don't do real pointer lock
        page.evaluate('''
            document.dispatchEvent(new Event('pointerlockchange'));
        ''')
        page.wait_for_timeout(500)

        # 5. Verify GAME PAUSED status exists and has correct role
        paused_status = page.locator('.loader-text', has_text='GAME PAUSED')
        if paused_status.is_visible():
            print('GAME PAUSED text is visible')
            role = paused_status.get_attribute('role')
            if role == 'status':
                print('GAME PAUSED has role="status"')
            else:
                print(f'GAME PAUSED has incorrect role: {role}')

        # 6. Verify Overlay has aria-modal
        overlay = page.locator('.ui-overlay.visible')
        if overlay.is_visible():
            aria_modal = overlay.get_attribute('aria-modal')
            print(f'Overlay aria-modal: {aria_modal}')

        # Take screenshot of Paused State
        page.screenshot(path='verification/paused_state.png')

        browser.close()

if __name__ == '__main__':
    verify_ui_changes()
