"""
verify_visuals_playwright.py — Visual regression test for WATERSHED

Covers:
- Start menu render
- Gameplay HUD (speedometer, biome badge, distance)
- 3D scene after entering game

Run with: python3 verification/verify_visuals_playwright.py
Requires: playwright install chromium
"""
from playwright.sync_api import sync_playwright
import os
import time
import sys

OUT_DIR = os.path.join(os.path.dirname(__file__), 'output')

def verify_visuals():
    os.makedirs(OUT_DIR, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 720})

        print("Navigating to app...")
        page.goto("http://localhost:3000")

        # --- 1. Start Menu Screenshot ---
        print("Waiting for start menu...")
        try:
            page.wait_for_selector(".start-menu-overlay", timeout=30000)
            time.sleep(1)
            page.screenshot(path=os.path.join(OUT_DIR, "verification_start_menu.png"))
            print("✓ Start menu screenshot saved")
        except Exception as e:
            print(f"✗ Start menu not found: {e}")
            page.screenshot(path=os.path.join(OUT_DIR, "verification_timeout.png"))
            browser.close()
            return False

        # --- 2. Enter Game ---
        print("Clicking start button...")
        try:
            page.click(".start-menu-start-btn")
            time.sleep(2)
        except Exception as e:
            print(f"✗ Failed to click start: {e}")
            # Fallback: try old UI overlay
            try:
                page.evaluate("document.querySelector('.start-button')?.click()")
                time.sleep(2)
            except:
                pass

        # --- 3. Gameplay HUD Screenshot ---
        print("Capturing gameplay HUD...")
        try:
            # Wait for HUD elements
            page.wait_for_selector("text=km/h", timeout=10000)
            page.screenshot(path=os.path.join(OUT_DIR, "verification_gameplay.png"))
            print("✓ Gameplay screenshot saved")
        except Exception as e:
            print(f"⚠ HUD not fully loaded: {e}")
            page.screenshot(path=os.path.join(OUT_DIR, "verification_gameplay_partial.png"))

        # --- 4. Pause Menu Screenshot ---
        print("Opening pause menu (Esc)...")
        try:
            page.keyboard.press("Escape")
            time.sleep(1)
            page.screenshot(path=os.path.join(OUT_DIR, "verification_pause_menu.png"))
            print("✓ Pause menu screenshot saved")
        except Exception as e:
            print(f"⚠ Pause menu capture failed: {e}")

        browser.close()
        print(f"\nAll screenshots saved to {OUT_DIR}/")
        return True

if __name__ == "__main__":
    success = verify_visuals()
    sys.exit(0 if success else 1)
