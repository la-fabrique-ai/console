import { createBackend } from '../../src/backend.mjs';
const backend=createBackend({root:process.argv[2]});
const {config,revision}=await backend.dispatch('read-config');
process.send({loaded:true,revision});
const name=await new Promise(resolve=>process.once('message',resolve));
config.projects[0].name=name;
for(let attempt=0;;attempt++) {
  try {
    await backend.dispatch('config-save',{config,baseRevision:revision});process.send({done:true});break;
  }catch(error) {
    if(error.code==='BUSY'&&attempt<100){await new Promise(resolve=>setTimeout(resolve,10));continue;}
    process.send({done:true,error:error.code});break;
  }
}
process.disconnect();
