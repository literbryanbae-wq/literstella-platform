import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {footerHtml} from './src/footer.mjs';
const base=dirname(fileURLToPath(import.meta.url));
const target=resolve(process.argv[2]||'.');
const app=process.argv[3];
if(!['read','class','challenge','english'].includes(app))throw Error('Usage: node sync.mjs <app root> read|class|challenge|english');
const hashes={};
function output(path,data){mkdirSync(dirname(resolve(target,path)),{recursive:true});writeFileSync(resolve(target,path),data);const content=/\.(?:mjs|js|jsx|css|json|webmanifest)$/.test(path)?data.toString().replace(/\r\n/g,'\n'):data;hashes[path]=createHash('sha256').update(content).digest('hex');}
for(const name of ['footer.mjs','footer.css','SiteFooter.jsx','serviceMenu.js'])output(`src/core/site-footer/${name}`,readFileSync(`${base}/src/${name}`));
for(const name of ['logo-symbol.png','logo-literstella-ko.png','favicon.png','favicon.ico','apple-touch-icon.png','icon-192.png','icon-512.png'])output(`public/brand/shared/${name}`,readFileSync(`${base}/assets/${name}`));
for(const name of ['favicon.ico','favicon.png'])output(`public/${name}`,readFileSync(`${base}/assets/${name}`));
const hp=app==='english'?'learning-platform-connected/index.html':'index.html';
let html=readFileSync(resolve(target,hp),'utf8');
html=html.replace(/<link\b[^>]*\brel=["'](?:shortcut icon|icon|apple-touch-icon)["'][^>]*>/gi,'');
html=html.replace('</head>','<link rel="icon" type="image/png" sizes="32x32" href="/brand/shared/favicon.png" />\n<link rel="apple-touch-icon" sizes="180x180" href="/brand/shared/apple-touch-icon.png" />\n</head>');
if(app==='read'){
 const start=html.indexOf('<footer class="site-footer">')>=0?html.indexOf('<footer class="site-footer">'):html.indexOf('<footer class="ls-site-footer"');
 const end=html.indexOf('</footer>',start)+9;if(start<0||end<9)throw Error('READ footer boundary missing');
 html=html.slice(0,start)+footerHtml({app,actions:['privacy','terms','refund']})+html.slice(end);
 html=html.replace(/<script type="module" src="\.\/footer-services.js"><\/script>/,'');
 if(!html.includes('./src/core/site-footer/footer.css'))html=html.replace('</head>','<link rel="stylesheet" href="./src/core/site-footer/footer.css" />\n</head>');
}
writeFileSync(resolve(target,hp),html);
const manifestFile=app==='english'?'public/manifest.webmanifest':(existsSync(resolve(target,'public/manifest.json'))?'public/manifest.json':'public/manifest.webmanifest');
const manifest=existsSync(resolve(target,manifestFile))?JSON.parse(readFileSync(resolve(target,manifestFile),'utf8')):{name:'올인원 영어 학습실',short_name:'LiterStella',start_url:'/',display:'standalone'};
manifest.icons=[192,512].map(n=>({src:`/brand/shared/icon-${n}.png`,sizes:`${n}x${n}`,type:'image/png'}));
output(manifestFile,JSON.stringify(manifest,null,2)+'\n');
if(!/rel=["']manifest["']/.test(html)){html=html.replace('</head>',`<link rel="manifest" href="/${manifestFile.slice(7)}" />\n</head>`);writeFileSync(resolve(target,hp),html);}
if(app==='english'){
 const p=resolve(target,'learning-platform/assets.mjs');let a=readFileSync(p,'utf8');
 const additions=Object.keys(hashes).filter(p=>p.startsWith('public/')).map(p=>p.slice(7)).filter(p=>!a.includes(`'${p}'`));
 a=a.replace('Object.freeze([',`Object.freeze([\n${additions.map(p=>`  '${p}',`).join('\n')}`);writeFileSync(p,a);
}
writeFileSync(resolve(target,'src/core/site-footer/manifest.json'),JSON.stringify(hashes,null,2)+'\n');
copyFileSync(`${base}/verify.mjs`,resolve(target,'scripts/verify-site-footer.mjs'));
const pkgPath=resolve(target,'package.json'),pkg=JSON.parse(readFileSync(pkgPath,'utf8'));
const key=app==='english'?'build:english-services':'prebuild';
if(!pkg.scripts[key]?.includes('verify-site-footer'))pkg.scripts[key]='node scripts/verify-site-footer.mjs'+(pkg.scripts[key]?' && '+pkg.scripts[key]:'');
writeFileSync(pkgPath,JSON.stringify(pkg,null,2)+'\n');
console.log('Synced footer and brand assets:',app);
