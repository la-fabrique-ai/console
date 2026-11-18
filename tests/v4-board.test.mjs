import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BOARD,boardOffered,planView,boardColumn,boardFold,boardLayout,acceptedTimes} from '../mods/fabrique-console-v4-ticket/board.js';
import {lineTickets,lineCard,lineEnds,lineLayout,linePan,lineLanes,lanesLayout,lanesPan} from '../mods/fabrique-console-v4-ticket/line.js';
import {W} from '../mods/fabrique-console-v4-ticket/words.js';
import {cardTitle} from '../mods/fabrique-console-v4-ticket/blocks.js';

// PRB-41 of the mockup, screen 09: four accepted, PRB-146 in dev, four to do.
const IDS=['PRB-142','PRB-144','PRB-149','PRB-145','PRB-146','PRB-147','PRB-150','PRB-151','PRB-148'];
const AT_09=['accepted','accepted','accepted','accepted','dev','todo','todo','todo','todo'];
const row=(id,n,state,extra={})=>({id,n,title:'Titre '+id,level:'standard',dev:'claude',model:'claude-opus-5-5',deps:n>1?[IDS[n-2]]:[],kind:'work',delivery:'included',state,rounds:0,...extra});
const mission=(states,extra={})=>({id:'M-1',project:'beta',step:'building',issue:{identifier:'PRB-41'},tickets:states.map((s,i)=>row(IDS[i]||'PRB-2'+String(i).padStart(2,'0'),i+1,s)),...extra});
const ENDS=[{key:'qa'},{key:'signoff'}],place=c=>[c.id,c.x,c.y,c.w,c.h,c.view];
const board=(states,more={})=>{const m=mission(states);return boardLayout({tickets:lineTickets(m),width:1012,ends:ENDS,...more});};

test('the rules of the Kanban are built with the other shared files of the V4 screens, and write no word of their own',async()=>{
  assert.match(await readFile(new URL('../scripts/build-ui.mjs',import.meta.url),'utf8'),/V4_SHARED=\[[^\]]*'board\.js'/);
  const text=await readFile(new URL('../mods/fabrique-console-v4-ticket/board.js',import.meta.url),'utf8');
  assert.equal(text,await readFile(new URL('../ui/v4/board.js',import.meta.url),'utf8'));
  assert.deepEqual([...text.split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n').matchAll(/(['"`])([A-Za-z]+ [^'"`\n]*)\1/g)].map(m=>m[2]),[],'no sentence of its own');
});
test('the Kanban has five columns, To do, Accepted and Validate equally wide, each card at its place (screen 09)',()=>{
  const d=board(AT_09);
  assert.deepEqual(d.cols.map(c=>[c.title,c.x,c.w,c.h,c.count]),[['To do',0,197,466,'4'],['In dev',203,198,466,'1'],['In review',407,198,466,'0'],['Accepted',611,197,466,'4'],['Validate',814,197,466,'2']]);
  assert.deepEqual(d.cols.map(c=>c.hint),['','','No review running. The reviewer steps in when the dev hands over.','','']);
  // Left, top, width, height of each card with the remaining width shared equally by To do, Accepted and Validate.
  assert.deepEqual(d.cards.map(place),[['PRB-142',617,400,185,32,'fold'],['PRB-144',617,278,185,116,'card'],['PRB-149',617,156,185,116,'card'],['PRB-145',617,34,185,116,'card'],
    ['PRB-146',209,34,186,202,'wide'],['PRB-147',6,34,185,92,'card'],['PRB-150',6,132,185,92,'card'],['PRB-151',6,230,185,92,'card'],['PRB-148',6,328,185,92,'card']]);
  assert.deepEqual(d.ends,[{key:'qa',x:820,y:34,w:185,h:116},{key:'signoff',x:820,y:156,w:185,h:116}]);
  assert.equal(d.height,466,'nothing to scroll');
});
test('a ticket goes to the column of its state, and stays there when it is stopped or waited for',()=>{
  assert.deepEqual(['todo','dev','fix','review','accepted','merged','canceled',undefined].map(state=>boardColumn({state})),[0,1,1,2,3,3,0,0]);
  // Screen 12: PRB-149 stopped while developed. It stays in « In dev », and its card is the red one of the line, with the
  // time since it stopped (22 min), not the one of its step.
  const m=mission(['accepted','accepted','dev','todo','todo','todo','todo','todo','todo']),tickets=lineTickets(m),items=[{type:'stuck',state:'pending',mission:'M-1',ticket:'PRB-149',createdAt:'2026-11-13T10:02:00Z'}];
  const d=boardLayout({tickets,width:1012,ends:ENDS}),card=lineCard(tickets[2],{stage:'develop',items,span:'38 min',now:Date.parse('2026-11-13T10:24:00Z')});
  assert.deepEqual(place(d.cards[2]),['PRB-149',209,34,186,202,'wide']);
  assert.deepEqual([card.look,card.word,card.sub,card.avatar],['blk','Blocked','22 min',{text:'D1',live:false}]);
  // Waited for in review (a verdict): still « In review ».
  const r=boardLayout({tickets:lineTickets(mission(['accepted','review','todo'])),width:1012,ends:ENDS});
  assert.deepEqual([r.cards[1].column,r.cards[1].view,r.cols[1].hint,r.cols[2].hint],[2,'wide','The dev waits for the review.','']);
});
test('To do keeps the order of the plan; Accepted puts the last one accepted first',()=>{
  const d=board(AT_09),ys=ids=>ids.map(id=>d.cards[IDS.indexOf(id)].y);
  assert.deepEqual(ys(['PRB-147','PRB-150','PRB-151','PRB-148']),[34,132,230,328]);
  assert.deepEqual(ys(['PRB-145','PRB-149','PRB-144','PRB-142']),[34,156,278,400]);
  // When the reports tell when each ticket was accepted, that order is the one shown (two devs: not the one of the plan).
  const tickets=lineTickets(mission(AT_09)),reports=[['PRB-142','10:00'],['PRB-144','13:00'],['PRB-149','11:00'],['PRB-145','12:00']].map(([ticket,at])=>({ticket,kind:'review-1',verdict:'accepted',at:'2026-11-13T'+at+':00.000Z'}));
  const times=acceptedTimes(tickets,[...reports,{ticket:'PRB-146',kind:'review-1',verdict:'accepted',at:'2026-11-13T14:00:00.000Z'},{ticket:'PRB-142',kind:'review-1',verdict:'changes_requested',at:'2026-11-13T15:00:00.000Z'}]);
  assert.deepEqual(Object.keys(times),['PRB-142','PRB-144','PRB-149','PRB-145'],'a ticket that is not accepted has no time');
  const t=boardLayout({tickets,width:1012,ends:ENDS,acceptedAt:times});
  assert.deepEqual(['PRB-144','PRB-145','PRB-149','PRB-142'].map(id=>t.cards[IDS.indexOf(id)].y),[34,156,278,400]);
});
test('Accepted with some times known: the ones accepted at a known time first, the last one first, then the others in the order of the plan reversed (review: P2)',()=>{
  // Six accepted, three at a known time (1 h, 2 h, 3 h), three without.
  const tickets=lineTickets(mission([...Array(6).fill('accepted'),'dev'])),at=h=>'2026-11-13T0'+h+':00:00.000Z';
  const acceptedAt={'PRB-142':at(1),'PRB-146':at(2),'PRB-149':at(3)};
  const column=d=>d.cards.filter(c=>c.column===3).sort((a,b)=>a.y-b.y).map(c=>c.id);
  assert.deepEqual(column(boardLayout({tickets,width:1012,ends:ENDS,acceptedAt})),['PRB-149','PRB-146','PRB-142','PRB-147','PRB-145','PRB-144']);
  // The same whatever the order the tickets come in: the rule does not depend on how the sort walks them.
  const shuffled={'PRB-149':at(3),'PRB-142':at(1),'PRB-146':at(2)};
  assert.deepEqual(column(boardLayout({tickets,width:1012,ends:ENDS,acceptedAt:shuffled})),['PRB-149','PRB-146','PRB-142','PRB-147','PRB-145','PRB-144']);
});
test('a column shows in full as many cards as it holds and folds the next ones on one line; beyond that the board scrolls',()=>{
  assert.deepEqual([1,4,5,6,7,8,11,12].map(n=>boardFold(n,92)),[1,4,4,3,2,2,0,0],'To do');
  assert.deepEqual([3,4,5,8,11].map(n=>boardFold(n,116)),[3,3,2,1,0],'Accepted');
  // Fifteen tickets (screen 42): four accepted, one in dev, ten to do, all folded and all shown.
  const d=board([...AT_09.slice(0,5),...Array(10).fill('todo')]),todo=d.cards.filter(c=>c.column===0);
  assert.deepEqual([todo.length,[...new Set(todo.map(c=>c.view))],todo[0].y,todo.at(-1).y,d.height],[10,['fold'],34,376,466]);
  // Twelve to do no longer fit, even folded: the board grows and scrolls in its zone; every column takes its height.
  const big=board(['dev',...Array(12).fill('todo')]);
  assert.deepEqual([big.height,[...new Set(big.cols.map(c=>c.h))],big.cards.at(-1).y],[488,[488],452]);
  // The order of the plan stays readable: the cards in full are the first ones, the next ticket at the top.
  const six=board(['dev',...Array(6).fill('todo')]).cards.slice(1);
  assert.deepEqual(six.map(c=>c.view),['card','card','card','fold','fold','fold']);assert.deepEqual(six.map(c=>c.y),[34,132,230,328,366,404]);
});
test('a ticket merged into another one, or canceled, stays in its column, folded, after the others, and is not counted',()=>{
  const m=mission(['accepted','dev','todo','todo','todo']);m.tickets[2].delivery='integrated';m.tickets[3].state='canceled';
  const d=boardLayout({tickets:lineTickets(m),width:1012,ends:ENDS});
  assert.deepEqual(d.cards.slice(2).map(place),[['PRB-149',6,132,185,32,'fold'],['PRB-145',6,170,185,32,'fold'],['PRB-146',6,34,185,92,'card']]);
  assert.equal(d.cols[0].count,'1');
});
test('In dev and In review show their ticket in large, one under the other when two devs each have one',()=>{
  const d=board(['dev','dev','review','todo']);
  assert.deepEqual(d.cards.slice(0,3).map(place),[['PRB-142',209,34,186,202,'wide'],['PRB-144',209,242,186,202,'wide'],['PRB-149',413,34,186,202,'wide']]);
  assert.deepEqual([d.cols[1].count,d.cols[2].count],['2','1']);
});
test('every ticket accepted, the two columns of the work say so; QA and Sign-off stand in Next',()=>{
  const d=board(Array(9).fill('accepted'),{done:true});
  assert.deepEqual(d.cols.map(c=>c.hint),['','All done.','All done.','','']);
  assert.deepEqual(d.ends.map(e=>e.key),['qa','signoff']);
  const ends=lineEnds({mission:mission(AT_09)});
  assert.deepEqual(ends.map(e=>[e.title,e.sub,e.word]),[['QA','one video per flow','Upcoming'],['Sign-off','what QA cannot judge','Upcoming']]);
  // Validate, with a fix asked at the sign-off (screen 31): the fix, a ticket without a rank, takes its column as any other.
  const fix=mission([...Array(9).fill('accepted')]);fix.step='validating';fix.tickets.push({id:'PRB-152',n:null,title:'Correctif',state:'dev',deps:[]});
  const v=boardLayout({tickets:lineTickets(fix),width:1012,ends:ENDS,done:true});
  assert.deepEqual([place(v.cards[9]),v.cols[1].count,v.cols[1].hint,v.cols[2].hint],[['PRB-152',209,34,186,202,'wide'],'1','','All done.']);
});
test('the board follows the width of its zone: the narrow columns keep theirs, To do, Accepted and Validate share the rest equally',()=>{
  const d=boardLayout({tickets:lineTickets(mission(AT_09)),width:966,ends:ENDS});
  assert.deepEqual(d.cols.map(c=>[c.x,c.w]),[[0,182],[188,198],[392,198],[596,182],[784,182]]);
  assert.equal(d.cols.at(-1).x+d.cols.at(-1).w,966);
  assert.deepEqual([d.cards[4].w,d.cards[5].w,d.ends[0].w],[186,170,170]);
});
test('in a narrow zone no column is out of reach: To do, Accepted and Validate narrow down equally to 110, then the board scrolls sideways (review: P2)',()=>{
  // A zone of 700: every column, QA and Sign-off are on the board, whose width says how far it scrolls.
  const d=board(AT_09,{width:700}),right=c=>c.x+c.w;
  assert.deepEqual(d.cols.map(c=>[c.title,c.x,c.w]),[['To do',0,110],['In dev',116,198],['In review',320,198],['Accepted',524,110],['Validate',640,110]]);
  assert.equal(d.width,750);assert.equal(right(d.cols.at(-1)),d.width);
  assert.ok(d.ends.every(e=>e.x+e.w<=d.width)&&d.cards.every(c=>c.x+c.w<=d.width));
  // Below 750 the board scrolls sideways; above it, To do, Accepted and Validate share the remaining width, rounded down.
  assert.deepEqual(board(AT_09,{width:860}).cols.map(c=>c.w),[146,198,198,146,146]);
  assert.deepEqual([board(AT_09,{width:860}).width,board(AT_09,{width:966}).width,board(AT_09).width],[858,966,1011]);
});
test('the page lets the board scroll sideways',async()=>{
  const main=await readFile(new URL('../mods/fabrique-console-v4-ticket/main.js',import.meta.url),'utf8');
  // Always sideways (the user: a scroll rather than a column cut), down too when a column is tall.
  assert.match(main,/host=d\.height>BOARD\.host\?host\.overflow_scrollbar\(\):host\.overflow_x_scrollbar\(\);/);
  assert.match(main,/id\('board-body'\)\.relative\(\)\.flex_none\(\)\.w\(d\.width\)\.h\(d\.height\)/);
});
test('a title too long for its card ends with « … », on the lines the mockup gives it: four on the line, two in a column of the Kanban (review: P3)',()=>{
  const long='Backlog : section sans sprint par fenêtres, dépôt placé par le serveur, puis la suite qui ne tient plus du tout dans la carte';
  // The card of the line (160 wide, four lines of 13) and one of a column (234 wide, two lines of 12.5).
  const line=cardTitle(long,{w:160,view:'line'}),column=cardTitle(long,{w:234,view:'card'});
  assert.ok(line.endsWith('…')&&column.endsWith('…'));
  assert.ok(line.length<=Math.floor(4*142/6.5)-8&&column.length<=Math.floor(2*216/6.25)-4,[line.length,column.length].join(' '));
  assert.ok(long.startsWith(line.slice(0,-1))&&long.startsWith(column.slice(0,-1)),'cut on what it says, nothing added');
  // A title that fits is left as it is; on one line the window cuts it itself.
  assert.equal(cardTitle('Liste chargée par fenêtres de 100 lignes',{w:234,view:'card'}),'Liste chargée par fenêtres de 100 lignes');
  assert.equal(cardTitle(long,{w:234,view:'fold'}),long);
});
test('the card writes its title cut by cardTitle, in the line and in the Kanban',async()=>{
  const card=await readFile(new URL('../mods/fabrique-console-v4-ticket/card.js',import.meta.url),'utf8');
  assert.equal([...card.matchAll(/\.child\(cardTitle\(card\.title,\{w,view\}\)\)/g)].length,2);
});
test('a ticket chosen is outlined on the board, what it waits for and what it unblocks are circled as on the line',()=>{
  const d=board(AT_09,{sel:'PRB-146'});
  assert.deepEqual(d.cards.filter(c=>c.sel||c.ring).map(c=>[c.id,c.sel,c.ring]),[['PRB-145',false,'waits'],['PRB-146',true,null],['PRB-147',false,'unblocks']]);
});
test('the plan offers its two views from Develop on, never in Prepare nor for a single ticket, and the view chosen is kept',()=>{
  assert.deepEqual(['prepare','develop','validate','closed'].map(stage=>boardOffered({stage,count:9})),[false,true,true,true]);
  assert.equal(boardOffered({stage:'develop',simple:true,count:1}),false);assert.equal(boardOffered({stage:'develop',count:0}),false);
  assert.deepEqual([planView('kanban',true),planView(null,true),planView('other',true),planView('kanban',false)],['kanban','line','line','line']);
  assert.equal(W.page.plan.kanban,'Kanban');assert.equal(W.page.plan.title,'Plan');
});
test('the page keeps the view in a shared value of the window, draws the same card in both views, and moves it natively',async()=>{
  const main=await readFile(new URL('../mods/fabrique-console-v4-ticket/main.js',import.meta.url),'utf8'),card=await readFile(new URL('../mods/fabrique-console-v4-ticket/card.js',import.meta.url),'utf8'),nav=await readFile(new URL('../mods/fabrique-console-v4-ticket/nav.js',import.meta.url),'utf8');
  assert.match(nav,/planView:'fabrique-console\.v4\.plan-view'/);
  assert.match(main,/setShared\(KEYS\.planView,key==='kanban'\?'kanban':null\)/);assert.match(main,/planView\(shared\(KEYS\.planView\),offered\)/);
  assert.equal([...main.matchAll(/ticketCard\(cards\[i\]/g)].length,2,'the line and the board draw the cards of lineCard with the one component');
  assert.match(card,/\.transition\('left',GLIDE\)\.transition\('top',GLIDE\)/,'a card glides to its new place, moved by the window');
  assert.doesNotMatch(main+card,/setTimeout|setInterval/);
  // A click on a card of the board opens the same details as on the line.
  assert.match(main,/moves:true,faded:[^\n]*onPick:\(_e,cx\)=>this\.pick\(box\.id,cx\)/);
});
test('the view of the plan changes nothing of the line: one dev and two devs are placed as before',()=>{
  const one=lineTickets(mission(AT_09)),at=linePan({count:9,width:1012,focus:4,active:4}),d=lineLayout({tickets:one,width:1012,pan:at.pan});
  assert.deepEqual([at.pan,d.cards[4].x,d.cards[4].y,d.cards[4].w,d.cards[4].h,d.ends[0].x],[338,346,40,160,196,862]);
  const two=mission(AT_09,{plan:{tickets:IDS.map((id,i)=>({id,dev:i%3===2?2:1}))}}),tickets=lineTickets(two),lanes=lineLanes(tickets),p=lanesPan({tickets,width:1012,focus:4});
  assert.deepEqual(lanes.map(l=>l.ids.length),[6,3]);
  const l=lanesLayout({tickets,width:1012,pans:p.lanes});
  assert.deepEqual([l.cards[0].y,l.cards[2].y,l.cards[0].w,l.cards[0].h,l.lanes.length],[40,254,150,182,2]);
  // The same tickets on the board: the cards of both devs in the columns of their states.
  assert.deepEqual(boardLayout({tickets,width:1012,ends:ENDS}).cols.map(c=>c.count),['4','1','0','4','2']);
});
