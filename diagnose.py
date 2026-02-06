#!/usr/bin/env python3
"""Diagnose blank screen issue by capturing browser console logs"""
import time
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={'width': 1280, 'height': 720}
    )
    page = context.new_page()
    
    console_logs = []
    
    def handle_console(msg):
        log_entry = f"[{msg.type.upper()}] {msg.text}"
        console_logs.append(log_entry)
        print(log_entry)
    
    page.on("console", handle_console)
    page.on("pageerror", lambda err: print(f"[PAGE ERROR] {err}"))
    
    print("=" * 60)
    print("Loading http://localhost:3000 ...")
    print("=" * 60)
    
    page.goto("http://localhost:3000", wait_until="networkidle", timeout=30000)
    
    # Wait a bit for the app to initialize
    time.sleep(5)
    
    print("\n" + "=" * 60)
    print("Console logs captured:")
    print("=" * 60)
    
    # Check if canvas exists
    canvas = page.locator('canvas')
    print(f"\nCanvas element found: {canvas.count() > 0}")
    
    # Take screenshot
    page.screenshot(path="diagnosis_screenshot.png")
    print("Screenshot saved to diagnosis_screenshot.png")
    
    browser.close()
    
    print("\n" + "=" * 60)
    print("Summary:")
    print("=" * 60)
    errors = [log for log in console_logs if '[ERROR]' in log]
    warnings = [log for log in console_logs if '[WARNING]' in log]
    
    if errors:
        print(f"\nFound {len(errors)} errors:")
        for e in errors:
            print(f"  - {e}")
    else:
        print("\nNo errors found in console logs.")
        
    if warnings:
        print(f"\nFound {len(warnings)} warnings:")
        for w in warnings[:5]:  # Show first 5
            print(f"  - {w}")
