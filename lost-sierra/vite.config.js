import { defineConfig } from 'vite';
export default defineConfig({
  root: import.meta.dirname,
  server: { fs: { allow: [new URL('../', import.meta.url).pathname] } },
  build: { outDir: 'dist', emptyOutDir: true, rolldownOptions: { input: { main: new URL('./index.html', import.meta.url).pathname, admin: new URL('./admin.html', import.meta.url).pathname } } },
});
