#!/usr/bin/env node
/**
 * preinstall guard (#465 B): pnpm is the package manager (`packageManager`),
 * and pnpm-lock.yaml is the only lockfile. `npm install` ignores it and the
 * `pnpm.overrides` block, and once pinned three r168 via a stray
 * package-lock.json. Refuse it rather than install a different tree.
 */
const agent = process.env.npm_config_user_agent ?? '';

if (!agent.startsWith('pnpm/')) {
  const name = agent.split('/')[0] || 'unknown';
  console.error(
    `[only-pnpm] This repo installs with pnpm, not ${name}. ` +
      'Run `corepack enable && pnpm install` (see packageManager in package.json).',
  );
  process.exit(1);
}
