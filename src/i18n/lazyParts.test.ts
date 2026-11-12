/**
 * Lazy English parts (#566): a part in en/lazy/ is registered by one chunk and
 * may only be rendered there — a key used by a boot-path file would read as its
 * own key until that chunk happened to load. Checks literal keys and
 * `` `prefix.${x}` `` templates; settingsDerive holds the Options' label keys as data.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { pauseMenu } from './en/lazy/pauseMenu';
import { runResults } from './en/lazy/runResults';
import { settingsPanel } from './en/lazy/settingsPanel';
import { todaysRiver } from './en/lazy/todaysRiver';
import { touchControls } from './en/lazy/touchControls';
import { userRivers } from './en/lazy/userRivers';

const lazy = { pauseMenu, runResults, settingsPanel, todaysRiver, touchControls, userRivers };

const OWNER: Record<keyof typeof lazy, { file: string; alsoNames?: string[] }> = {
  settingsPanel: { file: 'src/ui/SettingsPanel.tsx', alsoNames: ['src/systems/settings/settingsDerive.ts'] },
  pauseMenu: { file: 'src/components/PauseMenu.tsx' },
  runResults: { file: 'src/components/RunResultsPanel.tsx' },
  touchControls: { file: 'src/components/TouchControls.tsx' },
  todaysRiver: { file: 'src/components/TodaysRiverCard.tsx' },
  userRivers: { file: 'src/components/UserRiverPanel.tsx' },
};

const sources = execSync("git ls-files -co --exclude-standard 'src/**/*.ts' 'src/**/*.tsx'", { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((f) => !/\.(test|spec)\.tsx?$/.test(f) && !f.startsWith('src/i18n/'))
  .map((file) => ({ file, text: readFileSync(file, 'utf8') }));

describe('lazy English parts', () => {
  for (const [name, part] of Object.entries(lazy) as [keyof typeof lazy, Record<string, unknown>][]) {
    const { file, alsoNames = [] } = OWNER[name];
    const allowed = new Set([file, ...alsoNames]);

    it(`${name} is registered by ${file}`, () => {
      const text = readFileSync(file, 'utf8');
      expect(text).toContain(`registerEnglish(${name})`);
    });

    it(`${name}'s keys are used only in its chunk`, () => {
      const offenders: string[] = [];
      for (const key of Object.keys(part)) {
        const prefixes = key.split('.').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('.') + '.');
        for (const { file: f, text } of sources) {
          if (allowed.has(f)) continue;
          if (text.includes(`'${key}'`) || prefixes.some((p) => text.includes('`' + p + '${'))) offenders.push(`${key} in ${f}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});
