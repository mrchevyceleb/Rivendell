// The root package.json is the single source of the TARDIS version. Copy it
// into the desktop package (and its lockfile) so installers and the updater
// metadata carry the same number as the server and the Android build.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '..');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;

for (const file of ['package.json', 'package-lock.json']) {
  const target = path.join(desktop, file);
  let json;
  try {
    json = JSON.parse(readFileSync(target, 'utf8'));
  } catch {
    continue;
  }
  let changed = false;
  if (json.version !== version) {
    json.version = version;
    changed = true;
  }
  if (json.packages?.['']?.version && json.packages[''].version !== version) {
    json.packages[''].version = version;
    changed = true;
  }
  if (changed) {
    writeFileSync(target, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`desktop/${file}: version -> ${version}`);
  }
}
