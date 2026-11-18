import test from 'node:test';
import assert from 'node:assert/strict';

// Ticket M4: what the Lead must give for the page to show its requests in full is in its launch prompt and its role.
test('the Lead is told what the page shows of its request: its launch prompt and its role name short, details, tickets and kind',async()=>{
  const {leadPrompt}=await import('../src/po-launch.mjs'),{readFile}=await import('node:fs/promises');
  const prompt=leadPrompt({role:'',issue:null,project:{key:'example',name:'Example'},folder:'/tmp/x',resumed:false,mission:{id:'M-1',request:'Durcir'}}),role=await readFile(new URL('../roles/lead.md',import.meta.url),'utf8');
  for(const word of ['short','details','tickets','kind','suggestion','verdict','copy'])for(const [where,text] of [['prompt',prompt],['role',role]])assert.ok(text.includes(word),where+': '+word);
  assert.ok(prompt.includes('"short":"…"')&&prompt.includes('"details":{"…":"…"}'),'the example of the command carries them');
});
