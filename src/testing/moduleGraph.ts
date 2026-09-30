/**
 * moduleGraph — the runtime import graph of a worker entry, walked statically
 * (test helper). Follows relative static, dynamic and `export … from` imports;
 * type-only imports are skipped (erased at build). Bare specifiers are
 * collected, not followed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveModule(srcDir: string, from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]) {
    if (candidate.startsWith(srcDir) && existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

export interface ModuleGraph {
  /** Absolute path → source, for every reachable module under `srcDir`. */
  files: Map<string, string>;
  /** Bare (package) specifiers imported at runtime anywhere in the graph. */
  packages: Set<string>;
}

export function moduleGraph(srcDir: string, entry: string): ModuleGraph {
  const files = new Map<string, string>();
  const packages = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (files.has(file)) continue;
    const source = readFileSync(file, 'utf8');
    files.set(file, source);
    for (const match of source.matchAll(IMPORT_RE)) {
      if (/^(?:import|export)\s+type\s/.test(match[0])) continue;
      const spec = match[1] ?? match[2];
      if (!spec) continue;
      if (!spec.startsWith('.')) {
        packages.add(spec);
        continue;
      }
      const target = resolveModule(srcDir, file, spec);
      if (target) stack.push(target);
    }
  }
  return { files, packages };
}
