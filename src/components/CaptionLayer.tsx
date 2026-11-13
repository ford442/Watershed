/**
 * CaptionLayer.tsx — gameplay sounds as text, with where they came from (#558 C.3).
 *
 * Renders `caption` events (systems/audio/captions.ts): "◀ Log jam breaking",
 * "Dam release in 3 s". Off by default (Options → Accessibility → Captions);
 * GameHUD mounts this lazy chunk only while they are on. At most three lines; a repeat of a line
 * already up refreshes it instead of stacking, and a full layer drops its
 * lowest-priority, oldest line for a higher one.
 */

import React, { useEffect, useState } from 'react';
import { gameEvents, type CaptionDetail } from '../systems/events/GameEvents';
import { captionSound, startHazardCaptions } from '../systems/audio/captions';
import { setSoundCaptioner } from '../systems/settings/accessRuntime';
import { getAudioManager } from '../systems/audio/AudioSystem';
import { useT } from '../i18n/useT';
import { registerEnglish, type MessageKey } from '../i18n/i18n';
import { captions } from '../i18n/en/lazy/captions';

// This chunk's English rides with it, not the entry.
registerEnglish(captions);

/** Caption id (CaptionDetail.id) → its message. */
const CAPTION_KEYS: Readonly<Record<string, MessageKey>> = {
  splash: 'caption.splash',
  waterCrash: 'caption.waterCrash',
  raftTip: 'caption.raftTip',
  impact: 'caption.impact',
  hardLanding: 'caption.hardLanding',
  boost: 'caption.boost',
  hazardHit: 'caption.hazardHit',
  'logJam.telegraph': 'caption.logJam.telegraph',
  'logJam.active': 'caption.logJam.active',
  'iceBridge.telegraph': 'caption.iceBridge.telegraph',
  'iceBridge.active': 'caption.iceBridge.active',
  'damRelease.telegraph': 'caption.damRelease.telegraph',
  'damRelease.active': 'caption.damRelease.active',
  'flashFlood.telegraph': 'caption.flashFlood.telegraph',
  'flashFlood.active': 'caption.flashFlood.active',
};

const MAX_LINES = 3;
const SHOW_MS = 3000;
/** Hazard lines stay up a little longer: they are warnings. */
const SHOW_MS_HAZARD = 4500;

interface Line {
  key: number;
  id: string;
  direction: -1 | 0 | 1;
  priority: number;
  seconds?: number;
  until: number;
}

let nextKey = 1;

export default function CaptionLayer(): React.ReactElement | null {
  const t = useT();
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    const offHazards = startHazardCaptions(() => getAudioManager()?.getListener() ?? null);
    setSoundCaptioner(captionSound);
    const offCaption = gameEvents.on('caption', (c: CaptionDetail) => {
      if (!CAPTION_KEYS[c.id]) return;
      const now = performance.now();
      const until = now + (c.priority >= 3 ? SHOW_MS_HAZARD : SHOW_MS);
      setLines((prev) => {
        const live = prev.filter((l) => l.until > now);
        const same = live.findIndex((l) => l.id === c.id);
        const line: Line = {
          key: same >= 0 ? live[same].key : nextKey++,
          id: c.id,
          direction: c.direction,
          priority: c.priority,
          seconds: c.seconds,
          until,
        };
        if (same >= 0) {
          live[same] = line;
          return live;
        }
        if (live.length >= MAX_LINES) {
          // Drop the lowest-priority, oldest line — unless they all outrank this one.
          let drop = -1;
          for (let i = 0; i < live.length; i += 1) {
            if (live[i].priority <= c.priority && (drop < 0 || live[i].priority < live[drop].priority)) drop = i;
          }
          if (drop < 0) return live;
          live.splice(drop, 1);
        }
        return [...live, line];
      });
    });
    const sweep = window.setInterval(() => {
      const now = performance.now();
      setLines((prev) => (prev.some((l) => l.until <= now) ? prev.filter((l) => l.until > now) : prev));
    }, 250);
    return () => {
      offCaption();
      offHazards();
      setSoundCaptioner(null);
      window.clearInterval(sweep);
    };
  }, []);

  return (
    <div className="caption-layer" role="log" aria-live="polite" aria-label={t('caption.region')} data-testid="caption-layer">
      {lines.map((line) => {
        // A table of keys, some with `{seconds}`: the typed t cannot see which.
        const say = t as unknown as (key: MessageKey, params?: Record<string, number>) => string;
        const text = say(CAPTION_KEYS[line.id], { seconds: line.seconds ?? 0 });
        return (
          <div key={line.key} className={`caption-line caption-line--p${line.priority}`} data-direction={line.direction}>
            {line.direction < 0 && (
              <span className="caption-arrow" aria-label={t('caption.left')}>
                ◀
              </span>
            )}
            <span className="caption-text">{text}</span>
            {line.direction > 0 && (
              <span className="caption-arrow" aria-label={t('caption.right')}>
                ▶
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
