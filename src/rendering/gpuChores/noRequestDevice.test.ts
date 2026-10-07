import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * One GPUDevice per session: WebGPURenderer requests it, gpu-chores adopt
 * `backend.device` (device.ts). A second `requestDevice()` anywhere under src/
 * is a second device — buffers that cannot be shared, double the memory, and a
 * device-lost story nobody owns.
 */
const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__mocks__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('GPUDevice ownership', () => {
  it('no source file under src/ calls requestDevice()', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => /\brequestDevice\s*\(/.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
