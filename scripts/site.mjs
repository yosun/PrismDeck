import { copyFile } from 'node:fs/promises';
for(const file of ['prismdeck.js','prismdeck.css']) await copyFile('dist/'+file,'site/'+file);
