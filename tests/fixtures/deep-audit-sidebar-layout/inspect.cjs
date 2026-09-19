'use strict';
const fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'../../..');
const css=fs.readFileSync(path.join(repo,'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-b24khbeK.css'),'utf8');
console.log(css.split('}').filter(x=>/right|details|sidebar|320px|grid-template-columns/i.test(x)).map(x=>x+'}').join('\n'));
const js=fs.readFileSync(path.join(repo,'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-Df-65__b.js'),'utf8');
for(const needle of ['data-slot','rightSidebar','rightPanel','detailsPanel','panelSize','sidebarRight','resizable','320','data-hd-surface']) {let count=0;for(const m of js.matchAll(new RegExp(needle,'g'))){if(++count>8)break;console.log('\nJS '+needle+' @'+m.index+' '+js.slice(Math.max(0,m.index-200),m.index+500));}}
