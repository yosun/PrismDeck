import { build } from 'esbuild';
import { copyFile, mkdir, stat, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
await mkdir('dist', {recursive: true});
await build({entryPoints:['packages/dom/dist/index.js'], outfile:'dist/prismdeck.js', bundle:true, minify:true, format:'esm', target:'es2022', sourcemap:true, metafile:true});
await copyFile('packages/dom/src/style.css','dist/prismdeck.css');
for(const file of ['dist/prismdeck.js','dist/prismdeck.css']) console.log(`${file}: ${(await stat(file)).size} bytes; ${gzipSync(await readFile(file)).length} bytes gzip`);
