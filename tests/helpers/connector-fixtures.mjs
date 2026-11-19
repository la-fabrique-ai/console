import {readdir} from 'node:fs/promises';
const base=new URL('../../integrations/tickets/',import.meta.url);
import {DEFAULT_TICKET_DRIVER} from '../../integrations/tickets/factory.mjs';
// The shared engine fixtures belong to the default connector: the one every configuration without a driver uses.
const folders=(await readdir(base,{withFileTypes:true})).filter(e=>e.isDirectory()&&e.name===DEFAULT_TICKET_DRIVER);
if(folders.length!==1)throw new Error('Tests require the folder of the default ticket connector.');
export function connectorTestURL(file){
  if(!/^[a-z0-9/-]+(?:\.(?:suite|test))?\.mjs$/.test(file)||file.split('/').includes('..'))throw new Error('Invalid connector fixture.');
  return new URL(`${folders[0].name}/tests/${file}`,base);
}
export const connectorFixture=name=>import(connectorTestURL(`helpers/${name}.mjs`));
