import {readdir} from 'node:fs/promises';
const base=new URL('../../integrations/tickets/',import.meta.url);
const folders=(await readdir(base,{withFileTypes:true})).filter(e=>e.isDirectory()&&/^[a-z][a-z0-9-]*$/.test(e.name));
if(folders.length!==1)throw new Error('Tests require one bundled ticket connector.');
export function connectorTestURL(file){
  if(!/^[a-z0-9/-]+(?:\.(?:suite|test))?\.mjs$/.test(file)||file.split('/').includes('..'))throw new Error('Invalid connector fixture.');
  return new URL(`${folders[0].name}/tests/${file}`,base);
}
export const connectorFixture=name=>import(connectorTestURL(`helpers/${name}.mjs`));
