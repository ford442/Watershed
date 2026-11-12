/**
 * The lazy English parts, by type only (#566): `import type` is erased, so none
 * of these strings reach the entry through here. Each part's chunk imports it
 * for real and registers it (see en.ts).
 */
import type { pauseMenu } from './en/lazy/pauseMenu';
import type { runResults } from './en/lazy/runResults';
import type { settingsPanel } from './en/lazy/settingsPanel';
import type { todaysRiver } from './en/lazy/todaysRiver';
import type { touchControls } from './en/lazy/touchControls';
import type { userRivers } from './en/lazy/userRivers';

export type LazyEnglish = typeof pauseMenu &
  typeof runResults &
  typeof settingsPanel &
  typeof todaysRiver &
  typeof touchControls &
  typeof userRivers;
