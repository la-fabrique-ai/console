import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LOG, routedQuestion } from '../src/agent-texts.mjs';
import { leadPrompt } from '../src/po-launch.mjs';

// The Lead prepares alone and waits for the user's launch: its own role, not the PO's five validated steps.
test('the Lead has its own role: it prepares without asking for validation and never launches the devs before the user', async()=>{
  const role=await readFile(new URL('../roles/lead.md',import.meta.url),'utf8');
  assert.match(role,/^# Rôle : Lead/);
  assert.match(role,/sans demander à \{\{owner\}\} de valider/);
  assert.match(role,/Le lancement des devs est à \{\{owner\}\}/);
  assert.match(role,/\| Ticket \| Contenu \| Niveau \| Agent \| Modèle \| Effort \| Attend \|/,'the split table the user reads');
  assert.match(role,/Modèle : <modèle> · effort <effort>/,'the line a correction ticket outside the plan is launched with');
  assert.doesNotMatch(role,/po-ask|gate/,'no validation question of the PO');
  const prompt=leadPrompt({role,issue:{identifier:'ABC-1',title:'x'},project:{key:'acme',name:'Acme'},folder:'/w',resumed:false,mission:{id:'M-1',request:'Faire x'},cli:'/c',node:'/n'});
  assert.ok(prompt.startsWith('# Rôle : Lead'));
  assert.match(prompt,/ne partent qu'à la demande de lancement du propriétaire : jamais de kind launch avant elle/);
  assert.match(prompt,/lead-close/);assert.match(prompt,/seulement après la demande de clôture du propriétaire/);
  assert.match(role,/préparé par \{\{owner\}\} avec Pilot/,'the plan comes from Pilot');
  // Ticket M3: the Lead records what Prepare shows beside its tickets.
  for(const word of ['approach','migrations','toPlan','short','full','simple','points','accounts'])assert.match(role,new RegExp('`[^`]*'+word),word);assert.match(role,/Jamais avant sa demande : la commande la refuse/);
});

test('the watcher log names each agent with the contractions French wants', ()=>{
  const q=(from,extra={})=>({id:'Q-18',from,ticket:null,answer:{decision:'D-1',text:'Oui'},...extra});
  assert.equal(LOG.delivered(q('lead')),'Réponse à Q-18 livrée au Lead');
  assert.equal(LOG.delivered(q('qa')),'Réponse à Q-18 livrée à l’agent QA');
  assert.equal(LOG.delivered(q('review-2')),'Réponse à Q-18 livrée au second relecteur');
  assert.equal(LOG.asked(q('dev',{ticket:'ABC-2'})),'Question Q-18 du dev sur ABC-2');
  assert.match(routedQuestion({...q('dev'),question:'?',mission:'M-1'},{node:'/n',cli:'/c'}),/Question du dev \(Q-18\)/);
});
