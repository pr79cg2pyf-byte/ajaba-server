const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000 }).trim();
let build = { commit: 'unknown', dirty: null };
try {
  build = {
    commit: git('rev-parse', 'HEAD'),
    dirty: git('status', '--porcelain', '--', '.', ':!dist', ':!src/build-info.json') !== '',
  };
} catch {
  // Source archives may have no Git metadata; keep that uncertainty visible.
}
writeFileSync(resolve(root, 'src/build-info.json'), JSON.stringify(build) + '\n');
