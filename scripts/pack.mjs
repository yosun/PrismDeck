import { mkdirSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
mkdirSync('.artifacts', { recursive: true });
for (const name of ['core', 'dom', 'react', 'three']) {
  const result = spawnSync('npm', ['pack', '-w', `@prismdeck/${name}`, '--pack-destination', '.artifacts'], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const file of ["prismdeck.js", "prismdeck.js.map", "prismdeck.css"]) copyFileSync("dist/" + file, ".artifacts/" + file);
