import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

const reference=JSON.parse(await readFile(new URL('../../docs/backend-interface.json',import.meta.url),'utf8'));
export function assertInterfaceShape(name,value) {check(reference.types[name]?.shape??name,value,name);}
function check(shape,value,path) {
  if(shape===null||typeof shape==='boolean'||typeof shape==='number'){assert.equal(value,shape,path);return;}
  if(Array.isArray(shape)){assert.ok(Array.isArray(value),path+' must be an array');for(const [i,item] of value.entries())check(shape[0],item,path+'['+i+']');return;}
  if(typeof shape==='string') {
    if(reference.types[shape])return check(reference.types[shape].shape,value,path);
    if(shape.startsWith('nullable:')){if(value===null)return;return check(shape.slice(9),value,path);}
    if(shape.startsWith('const:')){assert.equal(value,shape.slice(6),path);return;}
    if(shape.startsWith('enum:')){assert.ok(shape.slice(5).split('|').includes(value),path+' invalid enum '+value);return;}
    if(shape==='any')return;
    if(shape==='integer'){assert.ok(Number.isInteger(value),path+' must be integer');return;}
    if(shape==='number'){assert.ok(typeof value==='number'&&Number.isFinite(value),path+' must be finite number');return;}
    if(shape==='boolean'){assert.equal(typeof value,'boolean',path);return;}
    if(['string','path','sha','revision','uuid','timestamp','code'].includes(shape)) {
      assert.equal(typeof value,'string',path);
      if(shape==='path')assert.ok(isAbsolute(value),path+' must be absolute');
      if(shape==='sha')assert.match(value,/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/,path);
      if(shape==='revision')assert.match(value,/^[a-f0-9]{64}$/,path);
      if(shape==='uuid')assert.match(value,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,path);
      if(shape==='timestamp')assert.ok(/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value)),path+' must be timestamp');
      if(shape==='code')assert.ok(Object.hasOwn(reference.codes,value),path+' undocumented code '+value);
      return;
    }
    assert.fail(path+' unknown shape '+shape);
  }
  if(shape.$oneOf) {
    const failures=[];
    for(const candidate of shape.$oneOf){try{check(candidate,value,path);return;}catch(error){failures.push(error.message);}}
    assert.fail(path+' matches no union: '+failures.join(' | '));
  }
  assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value),path+' must be object');
  if(shape.$record){for(const [key,item] of Object.entries(value))check(shape.$record,item,path+'.'+key);return;}
  const allowed=new Set(Object.keys(shape).filter(key=>key!=='*').map(key=>key.replace(/\?$/,'')));
  if(!Object.hasOwn(shape,'*'))assert.deepEqual(Object.keys(value).filter(key=>!allowed.has(key)),[],path+' unknown fields');
  for(const [raw,spec] of Object.entries(shape)) {
    if(raw==='*')continue;
    const optional=raw.endsWith('?'),key=raw.replace(/\?$/,'');
    if(optional&&!Object.hasOwn(value,key))continue;
    assert.ok(Object.hasOwn(value,key),path+' missing '+key);check(spec,value[key],path+'.'+key);
  }
}
