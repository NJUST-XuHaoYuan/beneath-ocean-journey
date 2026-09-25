import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(`dist/${name}`, root), 'utf8');
const data = (name, mime) => `data:${mime};base64,${readFileSync(new URL(`dist/${name}`, root)).toString('base64')}`;

let html = read('index.html');
const css = read('style.css').replace("url('./manrope.woff2')", `url('${data('manrope.woff2', 'font/woff2')}')`);
html = html.replace(/<link rel="stylesheet" href="style\.css(?:\?[^"]*)?">/, () => `<style>${css}</style>`);
html = html.replace(/\s*<script src="(?:shader|app)\.js(?:\?[^"]*)?" defer><\/script>/g, '');
const textures = ['sky', 'surface', 'underwater'].map(name => `window.OCEAN_${name.toUpperCase()}=${JSON.stringify(data(`${name}.jpg`, 'image/jpeg'))};`).join('\n');
const scripts = `<script>${textures}</script>\n` + ['shader.js', 'app.js'].map(name => `<script>${read(name)}</script>\n`).join('');
const license = read('FONT-LICENSE.txt').replaceAll('--', '—');
html = html.replace('</body>', () => `${scripts}<!-- Manrope font license:\n${license}\n-->\n</body>`);
mkdirSync(new URL('release/', root), { recursive: true });
writeFileSync(new URL('release/ocean.html', root), html);
console.log('Created release/ocean.html with all assets embedded.');
