import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
export default defineConfig({
  root: import.meta.dirname,
  plugins: [{ name: 'guide-version', transformIndexHtml: html => html.replaceAll('%GUIDE_VERSION%', version) }],
  server: { fs: { allow: [new URL('../', import.meta.url).pathname] } },
  build: { outDir: 'dist', emptyOutDir: true, rolldownOptions: { input: { main: new URL('./index.html', import.meta.url).pathname, admin: new URL('./admin.html', import.meta.url).pathname } } },
});
