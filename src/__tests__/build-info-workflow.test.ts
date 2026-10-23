import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

it('reports unknown build identity for a source archive without Git metadata', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ajaba-build-info-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    mkdirSync(join(directory, 'src'));
    const script = join(directory, 'scripts/write-build-info.cjs');
    copyFileSync(resolve('scripts/write-build-info.cjs'), script);
    execFileSync(process.execPath, [script], { timeout: 10000, stdio: 'pipe' });
    expect(JSON.parse(readFileSync(join(directory, 'src/build-info.json'), 'utf8')))
      .toEqual({ commit: 'unknown', dirty: null });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
