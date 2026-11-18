import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APPROVAL, COPY, copyRefusal, LOG } from '../src/mission.mjs';
import { JOURNAL } from '../src/dev-chain.mjs';

// Decision 87: the refusals of an approval and the messages told to the agent whose launch the gate refuses, in the
// words the user chose (Codex's recommendations, word for word).
test('the refusals of a reapproval say what to do',()=>{
  assert.equal(APPROVAL.notStarted,'The mission is still in Prepare. Use the plan’s approval button.');
  assert.equal(APPROVAL.noDrift,'There are no changes to approve.');
  assert.equal(APPROVAL.driftChanged,'The plan has changed again. Review the latest changes before approving.');
  assert.equal(APPROVAL.reopen,'Reopen the changes, review them, then approve.');
  // The Lead at work keeps the words of decision 74; the Lead waiting in its terminal has its own.
  assert.equal(APPROVAL.working,'The Lead is still preparing. Wait until it finishes, then approve.');
  assert.equal(APPROVAL.waiting,'The Lead is waiting. Check its terminal before approving.');
});

test('the agent refused a launch is told why, ticket by ticket, in French',()=>{
  assert.equal(COPY.absent('XJ-4'),'Lancement de XJ-4 refusé : le ticket n’est pas couvert par l’approbation actuelle. Ne le lance pas.');
  assert.equal(COPY.changed('XJ-4'),'Lancement de XJ-4 refusé : sa version actuelle diffère de la version approuvée. le propriétaire doit approuver les changements avant son lancement.');
  assert.equal(COPY.params('XJ-4'),'Lancement de XJ-4 refusé : l’outil, le modèle ou l’effort demandé diffère des paramètres approuvés. Utilise les paramètres approuvés, ou fais approuver leur modification par le propriétaire.');
  const ticket={id:'XJ-2',rank:1,title:'T',agent:'claude',model:'claude-sonnet-5-5',effort:'high'};
  const m=(copy,today)=>({approval:{at:'x',plan:{tickets:copy}},plan:{tickets:today}});
  assert.equal(copyRefusal(m([],[ticket]),'XJ-2').message,COPY.absent('XJ-2'));
  assert.equal(copyRefusal(m([ticket],[{...ticket,effort:'low'}]),'XJ-2').message,COPY.changed('XJ-2'));
  assert.equal(copyRefusal(m([ticket],[ticket]),'XJ-2',{asked:{tool:'codex',model:'gpt',effort:'high'}}).message,COPY.params('XJ-2'));
});

test('the refusals and agent messages Codex found false are written nowhere any more',()=>{
  const src=readFileSync(new URL('../src/mission.mjs',import.meta.url),'utf8');
  for(const old of ['Development has not started yet','Nothing has changed since the approval','The changes have moved','Read the changes again, then approve them.','copie figée du plan que the user a approuvé','le plan change et the user approuve ce changement'])assert.ok(!src.includes(old),old);
});

test('the journal: a launch failed, checked, asked again; a plan or changes approved; a launch blocked',()=>{
  assert.equal(JOURNAL.notStarted('TICKET_FAILED'),'Launch failed (TICKET_FAILED). No dev was started. You can request the launch again.');
  assert.equal(JOURNAL.notStarted(null),'Launch failed. No dev was started. You can request the launch again.','no code, no parentheses');
  assert.equal(JOURNAL.sequence,'Launch checked: the ticket sequence is enabled.');
  assert.equal(JOURNAL.stage('Validate'),'Launch checked: the mission is in Validate.');
  assert.equal(JOURNAL.noStart,'Launch checked: no dev start was recorded. You can request the launch again.');
  assert.equal(JOURNAL.blocked('XJ-4'),'Launch blocked for XJ-4.');
  assert.deepEqual(JOURNAL.refused,{NOT_IN_COPY:'This ticket is not covered by your approval.',COPY_CHANGED:'This ticket differs from its approved version.',NOT_AS_APPROVED:'The requested tool, model or effort differs from your approval.'});
  assert.equal(LOG.again,'New launch request recorded for the Lead.');
  assert.equal(LOG.updated,'Updated plan approved by you.');
  // The parts of the plan by their names on the page, never their identifiers.
  assert.equal(LOG.changesApproved([{ticket:'XJ-3'},{part:'toPlan.risks'},{part:'toPlan.manual'},{part:'branch'}]),'Changes approved by you: XJ-3, Risks, Your manual steps, Branch.');
});

test('the journal texts Codex found false are written nowhere any more',()=>{
  const chain=readFileSync(new URL('../src/dev-chain.mjs',import.meta.url),'utf8'),mission=readFileSync(new URL('../src/mission.mjs',import.meta.url),'utf8');
  for(const old of ['le dev est parti','Lancement non parti','Lancement vérifié','aucun dev n\\\'est parti'])assert.ok(!chain.includes(old),old);
  for(const old of ['Lancement redemandé au Lead','Plan modifié approuvé par the user','Changements approuvés par the user'])assert.ok(!mission.includes(old),old);
});
