// Turn the Vite bundle into one file that also works when opened with file://.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
let html = fs.readFileSync(path.join(dist, 'app.html'), 'utf8');
const script = html.match(/<script type="module"[^>]*src="\.\/assets\/([^"]+\.js)"[^>]*><\/script>/);
const stylesheet = html.match(/<link rel="stylesheet"[^>]*href="\.\/assets\/([^"]+\.css)"[^>]*>/);
if (!script || !stylesheet) throw new Error('Could not locate bundled JavaScript and CSS in app.html');
const js = fs.readFileSync(path.join(dist, 'assets', script[1]), 'utf8').replaceAll('</script', '<\\/script');
const css = fs.readFileSync(path.join(dist, 'assets', stylesheet[1]), 'utf8').replaceAll('</style', '<\\/style');
const map = JSON.parse(fs.readFileSync(path.join(root, 'public/beckwourth/map.json'), 'utf8'));
const ride = JSON.parse(fs.readFileSync(path.join(root, 'public/beckwourth/ride.json'), 'utf8'));
const terrain = fs.readFileSync(path.join(root, 'public/beckwourth/terrain.bin')).toString('base64');
const data = JSON.stringify({ map, ride, terrain }).replaceAll('<', '\\u003c');
html = html.replace(stylesheet[0], () => `<style>${css}</style>`);
html = html.replace(script[0], () => `<script>window.__BECKWOURTH__=${data}</script><script type="module">${js}</script>`);
// Bundled shader strings contain incidental trailing indentation; keep the
// generated source friendly to Git without changing their GLSL tokens.
html = html.split('\n').map(line => line.replace(/^ +(?=\t)/, '').replace(/[ \t]+$/, '')).join('\n');
fs.writeFileSync(path.join(root, 'index.html'), html);
fs.writeFileSync(path.join(dist, 'index.html'), html);
console.log(`Wrote self-contained index.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
