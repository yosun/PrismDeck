import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const name of ['core', 'three', 'dom', 'react']) {
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', `packages/${name}/tsconfig.json`], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const bundle = spawnSync(process.execPath, ["scripts/bundle.mjs"], {cwd: root, stdio: "inherit"});
if (bundle.status !== 0) process.exit(bundle.status ?? 1);
