import { readFile } from 'node:fs/promises';
import { createBackend } from '../../src/backend.mjs';
import { withFakeHerdr } from './fake-herdr.mjs';
const job=JSON.parse(await readFile(process.argv[2],'utf8'));
const backend=createBackend(withFakeHerdr({root:job.root,workspaceOptions:job.workspaceOptions??{},tracker:{detail:async id=>({issue:job.issues.find(issue=>issue.id===id)})}},'/fixture/forbidden-hc'));
process.send({ready:true});await new Promise(resolve=>process.once('message',resolve));
try{const result=await backend.dispatch(job.action,job.input);process.send({done:true,result});if(job.holdAtResult)await new Promise(resolve=>process.once('message',resolve));}
catch(error){process.send({done:true,error:error.code||error.message});}
process.disconnect();
