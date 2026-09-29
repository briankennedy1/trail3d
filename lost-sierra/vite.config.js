import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
function guideVersion(){
  const built=new Date().toISOString();
  const git=(...args)=>execFileSync('git',args,{cwd:import.meta.dirname,stdio:['ignore','pipe','ignore']}).toString().trim();
  try{
    const dirty=git('status','--porcelain')!=='';
    return {label:String(Number(git('rev-list','--count','HEAD'))+(dirty?1:0)),detail:`Built ${built} from ${git('rev-parse','--short','HEAD')}${dirty?' + uncommitted changes':''}`};
  }catch{
    return {label:`${version}+${built.replace(/\D/g,'')}`,detail:`Built ${built}`};
  }
}
export default defineConfig({
  root: import.meta.dirname,
  plugins: [{ name: 'guide-version', transformIndexHtml: html => {
    const {label,detail}=guideVersion();
    return html.replaceAll('%GUIDE_VERSION%',label).replaceAll('%GUIDE_VERSION_DETAIL%',detail);
  } }],
  server: { fs: { allow: [new URL('../', import.meta.url).pathname] } },
  build: { outDir: 'dist', emptyOutDir: true, rolldownOptions: { input: { main: new URL('./index.html', import.meta.url).pathname, admin: new URL('./admin.html', import.meta.url).pathname } } },
});
