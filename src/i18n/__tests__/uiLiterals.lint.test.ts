// @vitest-environment node
/**
 * The UI-literal lint block (#566): each of its selectors fires, a word-free
 * literal passes, and the owned-globals rules the block has to repeat still fire
 * in a UI file (a later no-restricted-syntax replaces an earlier one's list).
 */
import { ESLint } from 'eslint';

const UI_FILE = 'src/components/Loader.tsx';
const DEV_FILE = 'src/components/DebugPanel.tsx';

async function restricted(code: string, filePath = UI_FILE): Promise<string[]> {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.message);
}

const TEXT = /^Player-visible text/;

describe('UI-literal lint block', () => {
  it.each([
    ['JSX text', 'export const A = () => <p>Hello</p>;'],
    ['an aria-label literal', 'export const A = () => <button aria-label="Close" />;'],
    ['a title template literal', 'export const A = ({ n }: { n: string }) => <i title={`Rebind ${n}`} />;'],
    ['a string literal in a JSX expression', "export const A = () => <p>{'Hello'}</p>;"],
    ['a ternary arm in a child', "export const A = (p: { x: boolean }) => <p>{p.x ? 'On' : 'Off'}</p>;"],
  ])('flags %s', async (_name, code) => {
    const messages = await restricted(code);
    expect(messages.some((m) => TEXT.test(m))).toBe(true);
  }, 30_000);

  it('passes symbols, digits, t() calls and className ternaries', async () => {
    const code = [
      "import { t } from '../i18n/i18n';",
      "export const A = (p: { x: boolean }) => <p className={p.x ? 'active' : ''} title={t('locale.en')}>× → 3° — {t('locale.en')}</p>;",
    ].join('\n');
    expect(await restricted(code)).toEqual([]);
  }, 30_000);

  it('still fires the owned-globals rules in a UI file', async () => {
    const messages = await restricted("export const A = () => { window.dispatchEvent(new Event('x')); return null; };");
    expect(messages.some((m) => /gameEvents\.emit/.test(m))).toBe(true);
  }, 30_000);

  it('leaves developer overlays on the allowlist alone', async () => {
    expect((await restricted('export const A = () => <p>Hello</p>;', DEV_FILE)).filter((m) => TEXT.test(m))).toEqual([]);
  }, 30_000);
});
