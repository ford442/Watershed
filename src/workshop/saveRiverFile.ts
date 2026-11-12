/**
 * saveRiverFile.ts — a river as a compressed `.wsriver` on the player's disk
 * (River Workshop D.2): the File System Access API's save dialog where the
 * browser has one, an `<a download>` everywhere else.
 */
import type { LevelData } from '../systems/map/MapSystem.types';
import { encodeRiverFile, riverFileName } from '../systems/map/riverShare';

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}
interface WritableFile {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
interface SaveFileHandle {
  createWritable(): Promise<WritableFile>;
}
type ShowSaveFilePicker = (options?: SaveFilePickerOptions) => Promise<SaveFileHandle>;

export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled';

/** Save `level` as `<name>.wsriver` (v2, deflated). */
export async function saveRiverFile(level: LevelData): Promise<SaveOutcome> {
  const blob = new Blob([encodeRiverFile(level)], { type: 'application/json' });
  const name = riverFileName(level);
  const picker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
  if (typeof picker === 'function') {
    try {
      const handle = await picker.call(window, {
        suggestedName: name,
        types: [{ description: 'Watershed river', accept: { 'application/json': ['.wsriver'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // A picker that exists but refuses (a sandboxed frame): fall through to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
