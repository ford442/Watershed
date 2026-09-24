/**
 * PauseMenu rival import — #449 E1: a `.wsghost` from another launch hour is
 * refused with the reason on screen, never stored and raced silently.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PauseMenu from './PauseMenu';
import { exportGhostToJson } from '../systems/ghost/ghostExport';
import { encodeGhostSamples, encodeGhostToBase64 } from '../systems/ghost/ghostCodec';
import { buildGhostHydroFairness } from '../systems/ghost/hydroFairness';
import { currentRunFairness, hydroEventsForMap } from '../systems/ghost/raceFairness';
import {
  getRivalGhost,
  resetPersistenceForTests,
  setRivalGhost,
} from '../systems/persistence/PersistenceSystem';
import { resetRunSessionForTests } from '../systems/journey/runSession';
import { importGhostFromJson } from '../systems/ghost/ghostExport';
import { getActiveMapId } from '../utils/runContext';

const PAYLOAD = encodeGhostToBase64(
  encodeGhostSamples([{ px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 }]),
);

function ghostJsonAt(hour: number): string {
  const mapId = getActiveMapId();
  const fairness = buildGhostHydroFairness({
    launchHour: hour,
    events: hydroEventsForMap(mapId),
    qualityPreset: currentRunFairness(mapId).qualityPreset ?? 'high',
  });
  return exportGhostToJson(mapId, 60_000, PAYLOAD, undefined, fairness);
}

function renderMenu() {
  return render(<PauseMenu onResume={() => {}} onRestart={() => {}} onQuit={() => {}} onOpenOptions={() => {}} />);
}

function pickFile(container: HTMLElement, json: string) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([json], 'rival.wsghost', { type: 'application/json' });
  // jsdom's File has no Blob#text().
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(json) });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('PauseMenu rival fairness', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPersistenceForTests();
    resetRunSessionForTests();
  });

  it('shows the river being raced', () => {
    renderMenu();
    const hour = String(currentRunFairness().launchHour).padStart(2, '0');
    expect(screen.getByText(new RegExp(`RACING H${hour}:00 ${getActiveMapId().toUpperCase()}`))).toBeTruthy();
  });

  it('refuses a rival file from another launch hour and says why', async () => {
    const own = currentRunFairness().launchHour ?? 6;
    const other = (own + 8) % 24;
    const { container } = renderMenu();
    pickFile(container, ghostJsonAt(other));
    await waitFor(() => expect(screen.getByText(/Rival refused: rival was H\d\d:00 — you launched/)).toBeTruthy());
    expect(getRivalGhost(getActiveMapId())).toBeUndefined();
  });

  it('loads a rival from the same hour', async () => {
    const { container } = renderMenu();
    pickFile(container, ghostJsonAt(currentRunFairness().launchHour ?? 6));
    await waitFor(() => expect(getRivalGhost(getActiveMapId())).toBeDefined());
  });

  it('labels a stored rival that no longer matches the hour as hidden', () => {
    const own = currentRunFairness().launchHour ?? 6;
    const result = importGhostFromJson(ghostJsonAt((own + 8) % 24), getActiveMapId());
    if (!result.ok) throw new Error('fixture import failed');
    setRivalGhost(getActiveMapId(), result.file);
    renderMenu();
    expect(screen.getByText(/Rival hidden: rival was H\d\d:00 — you launched/)).toBeTruthy();
  });
});
