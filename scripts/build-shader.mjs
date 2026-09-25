import { readFileSync, writeFileSync } from 'node:fs';

// Keep the GLSL source editable while serving a classic script that also works
// directly from a local HTML file, without fetch(), a server or dependencies.
const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('src/ocean.frag', root), 'utf8');
writeFileSync(new URL('dist/shader.js', root), `window.OCEAN_FRAGMENT = ${JSON.stringify(source)};\n`);
