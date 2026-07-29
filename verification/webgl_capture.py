#!/usr/bin/env python3
"""Capture WebGL2 screenshots of Map 1 for CI / visual verification.

Requires: playwright (`pip install playwright && playwright install chromium`)
           dev server on localhost:3000 (`pnpm dev`)

Output: verification/output/webgl/*.png + capture_report.json
"""

from playwright.sync_api import sync_playwright
import time
import os
import json
import sys

OUT_DIR = os.path.join(os.path.dirname(__file__), 'output', 'webgl')
BASE = os.environ.get('WATERSHED_URL', 'http://launchhost:3000').replace('launchhost', 'localhost')

SHOTS = [
    # name, url_suffix, mode, load_wait_s, segment (None = prestart only)
    ('01_meander_start', '?renderer=webgl&screenshot=1', 'prestart', 28, None),
    ('02_glacier_topdown', '?renderer=webgl&no-pointer-lock=1&screenshot=1', 'topdown', 10, -3),
    ('03_meander_mid', '?renderer=webgl&no-pointer-lock=1&screenshot=1', 'topdown', 10, 5),
    ('04_pre_waterfall', '?renderer=webgl&no-pointer-lock=1&screenshot=1', 'topdown', 10, 13),
    ('05_waterfall', '?renderer=webgl&no-pointer-lock=1&screenshot=1', 'topdown', 10, 14),
    ('06_pond', '?renderer=webgl&no-pointer-lock=1&screenshot=1', 'topdown', 10, 16),
    ('07_slot_canyon', '?renderer=webgl&no-pointer-lock=1&screenshot=1', 'topdown', 10, 21),
    ('08_delta', '?renderer=webgl&no-pointer-lock=1&screenshot=1', 'topdown', 10, 33),
]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    report = {'baseUrl': BASE, 'captures': [], 'parityNotes': []}

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--use-gl=swiftshader', '--ignore-gpu-blocklist'],
        )
        page = browser.new_page(viewport={'width': 1280, 'height': 720})

        for name, suffix, mode, wait_s, segment in SHOTS:
            url = BASE + suffix
            print(f'Capturing {name} …')
            page.goto(url, wait_until='load', timeout=90000)
            page.wait_for_selector('canvas', timeout=60000)

            if mode == 'prestart':
                time.sleep(wait_s)
            else:
                time.sleep(6)
                page.evaluate("() => document.querySelector('.start-menu-start-btn')?.click()")
                page.wait_for_function(
                    '() => !!window.__watershedPhysicsDebug',
                    timeout=60000,
                )
                time.sleep(2)
                if segment is not None:
                    page.evaluate(
                        '(s) => window.__watershedScreenshot?.teleportToSegment(s)',
                        segment,
                    )
                time.sleep(wait_s)

            path = os.path.join(OUT_DIR, f'{name}.png')
            page.screenshot(path=path, full_page=False)
            size = os.path.getsize(path)
            report['captures'].append({
                'file': f'{name}.png',
                'url': url,
                'mode': mode,
                'segment': segment,
                'bytes': size,
                'ok': size > 50000,
            })
            print(f'  → {name}.png ({size} bytes)')

        browser.close()

    good = sum(1 for c in report['captures'] if c['ok'])
    report['goodCount'] = good
    report['parityNotes'] = [
        '01 prestart (28s load): full WebGL canyon visible behind start menu — most reliable headless frame.',
        '?no-pointer-lock: top-down camera + pink HeadlessPlayerMarker for downstream teleports.',
        'First-person post-start screenshots are ~4KB blank under SwiftShader — use topdown or prestart.',
        'Force ?renderer=webgl; WebGPU default throws lightNodeClass under SwiftShader.',
        '?screenshot=1: preserveDrawingBuffer + window.__watershedScreenshot teleport API.',
    ]

    report_path = os.path.join(OUT_DIR, 'capture_report.json')
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2)

    print(f'\nGood frames: {good}/{len(report["captures"])}')
    print(f'Report: {report_path}')
    return 0 if good >= 4 else 1


if __name__ == '__main__':
    sys.exit(main())
