import test from 'node:test';
import assert from 'node:assert/strict';
import {LINE,TWO,lineTickets,linePhases,lineFocus,lineActive,linePan,lineJump,lineLayout,lineDev,lineDevs,lineLanes,lanesPan,lanesLayout,lineCard,lineHead,lineDetail} from '../mods/fabrique-console-v4-ticket/line.js';
import {pageBand,pageWorkers,pageTabs,devOf,devCount} from '../mods/fabrique-console-v4-ticket/page.js';
import {pageStrip,pageCurrent,pageTokens,pageSheet,pageSpans} from '../mods/fabrique-console-v4-ticket/blocks.js';
import {pageAnswer} from '../mods/fabrique-console-v4-ticket/answers.js';

// Two devs, in two lanes (screens 40 and 41 of the mockup): PRB-41, its nine tickets and what each waits for
// (source/Main.dc.html); Dev 1 (Codex) has six of them, Dev 2 (Claude Code) the three of « Charger par fenêtres ». The plan
// says which dev has a ticket (plan.tickets[].dev: 2 for Dev 2, nothing for Dev 1); the tool of a ticket says nothing of it.
const DEPS={'PRB-142':[],'PRB-144':['PRB-142'],'PRB-149':['PRB-144'],'PRB-145':['PRB-149'],'PRB-146':['PRB-145'],'PRB-147':['PRB-146'],'PRB-150':['PRB-147'],'PRB-151':['PRB-147'],'PRB-148':['PRB-144','PRB-150','PRB-151']};
const PHASE={'PRB-142':'p1','PRB-144':'p2','PRB-149':'p2','PRB-145':'p3','PRB-146':'p3','PRB-147':'p3','PRB-150':'p4','PRB-151':'p4','PRB-148':'p5'};
const HEAVY=['PRB-146','PRB-147'],LIGHT=['PRB-151','PRB-148'],IDS=Object.keys(DEPS),SECOND=['PRB-145','PRB-146','PRB-147'];
const PHASES=[['p1','Mesurer'],['p2','Préparer la base'],['p3','Charger par fenêtres'],['p4','Alléger, documenter'],['p5','Mesurer']].map(([id,title])=>({id,title}));
const toolOf=(id,second=SECOND)=>second.includes(id)?{dev:'claude',model:'claude-opus-5-5'}:{dev:'codex',model:'gpt-6.1-sol'};
const row=(id,n,state='todo',extra={})=>({id,n,title:'Titre '+id,level:HEAVY.includes(id)?'fort':LIGHT.includes(id)?'léger':'standard',...toolOf(id),effort:'high',deps:DEPS[id]||[],kind:'work',delivery:'included',integratedBy:null,state,rounds:0,...extra});
const planTicket=(id,n,second=SECOND)=>({...(second.includes(id)?{dev:2}:{}),id,rank:n,title:'Titre '+id,result:'Résultat '+id,difficulty:HEAVY.includes(id)?'heavy':LIGHT.includes(id)?'light':'standard',kind:'work',delivery:'included',deps:DEPS[id]||[],phase:PHASE[id]||null,texts:id==='PRB-151'?['guide /aide']:[],mockups:[]});
const jir41=(step,states={},change=t=>t,second=SECOND)=>({id:'M-1',project:'beta',step,issue:{identifier:'PRB-41'},branch:'prb-41',base:'origin/main',tickets:IDS.map((id,i)=>change(row(id,i+1,states[id]||'todo'))),plan:{format:2,tickets:IDS.map((id,i)=>planTicket(id,i+1,second)),phases:PHASES}});
const one=(step,states={})=>jir41(step,states,t=>({...t,dev:'claude',model:'claude-opus-5-5'}),[]);
// Two devs that use the same tool: the three tickets of Dev 2 are developed with Codex too.
const sameTool=(step,states={})=>jir41(step,states,t=>({...t,dev:'codex',model:'gpt-6.1-sol'}));
// Screen 41: four accepted, PRB-146 in dev with Dev 2. Screen 40: the plan ready, nothing started.
const AT_41={'PRB-142':'accepted','PRB-144':'accepted','PRB-149':'accepted','PRB-145':'accepted','PRB-146':'dev'};
// The zone of the mockup is 1012 wide: QA and Sign-off at 862.
const W41=1012,box=(x,y,w,h)=>({x,y,w,h});
// What a set of rectangles covers, point by point: two drawings of the same lines are the same ink, however they are cut.
const ink=rects=>{const out=new Set();for(const r of rects)for(let x=r.x;x<r.x+r.w;x++)for(let y=r.y;y<r.y+r.h;y++)out.add(x+','+y);return [...out].sort();};
const lead={address:'t1',status:'idle'};
const tab=(address,tab_name,status='working')=>({address,tab_name,status,space:'sp'});

test('the tickets are shared out between the devs as the plan says, whatever their tool; a dev has one tool, and its model is said when it has one only',()=>{
  const tickets=lineTickets(jir41('analysing')),devs=lineDevs(tickets);
  assert.deepEqual(devs.map(d=>[d.n,d.badge,d.name,d.tool,d.label,d.count,d.ids]),[
    [1,'D1','Dev 1','codex','Codex · gpt-6.1-sol','6 tickets',['PRB-142','PRB-144','PRB-149','PRB-150','PRB-151','PRB-148']],
    [2,'D2','Dev 2','claude','Claude Code · opus 5.5','3 tickets',SECOND]]);
  assert.deepEqual(lineLanes(tickets),devs,'two devs: two lanes');
  assert.deepEqual(tickets.map(t=>lineDev(tickets,t)),[1,1,1,2,2,2,1,1,1],'the same numbers as on the cards and in the details');
  // The numbers of the page (banner, « Who's working ») are those of the lanes.
  const m=jir41('analysing');
  assert.equal(devCount(m),2);assert.deepEqual(IDS.map(id=>devOf(m,id)),[1,1,1,2,2,2,1,1,1]);assert.equal(devOf(m,'PRB-999'),1);
  // Two devs that use the same tool are two devs still (review of the screen, P1): two lanes, each with its tickets.
  const same=sameTool('analysing'),twins=lineTickets(same);
  assert.deepEqual(lineDevs(twins).map(d=>[d.n,d.name,d.tool,d.label,d.count,d.ids]),[
    [1,'Dev 1','codex','Codex · gpt-6.1-sol','6 tickets',['PRB-142','PRB-144','PRB-149','PRB-150','PRB-151','PRB-148']],
    [2,'Dev 2','codex','Codex · gpt-6.1-sol','3 tickets',SECOND]]);
  assert.equal(lineLanes(twins).length,2);assert.deepEqual(twins.map(t=>lineDev(twins,t)),[1,1,1,2,2,2,1,1,1]);
  assert.equal(devCount(same),2);assert.deepEqual(IDS.map(id=>devOf(same,id)),[1,1,1,2,2,2,1,1,1]);
  // A plan that does not say the dev of its tickets has one dev, even with two tools: no lane, and no tool said for Dev 1.
  const legacy=jir41('analysing',{},t=>t,[]),old=lineTickets(legacy);
  assert.deepEqual(lineDevs(old).map(d=>[d.n,d.tool,d.label,d.count,d.ids.length]),[[1,null,'','9 tickets',9]]);assert.equal(lineLanes(old),null);
  assert.equal(devCount(legacy),1);assert.deepEqual(IDS.map(id=>devOf(legacy,id)),Array(9).fill(1));
  // The model of a dev can change from a ticket to another: the lane then says its tool alone, and chooses no model.
  const mixed=lineTickets(jir41('analysing',{},t=>t.id==='PRB-148'?{...t,model:'gpt-6-luna'}:t));
  assert.deepEqual(lineDevs(mixed).map(d=>d.label),['Codex','Claude Code · opus 5.5']);
  // A ticket merged into another, or canceled, is not counted in its lane; « 1 ticket » is said in the singular.
  const fused=lineTickets(jir41('analysing',{'PRB-147':'canceled'},t=>t.id==='PRB-146'?{...t,delivery:'integrated',integratedBy:'PRB-145'}:t));
  assert.deepEqual(lineDevs(fused).map(d=>d.count),['6 tickets','1 ticket']);
  // One dev, or no tool told: one dev that has every ticket, and no lane.
  const alone=lineTickets(one('analysing')),bare=lineTickets(jir41('analysing',{},t=>({...t,dev:null,model:null}),[]));
  assert.deepEqual(lineDevs(alone).map(d=>[d.n,d.label,d.count,d.ids.length]),[[1,'Claude Code · opus 5.5','9 tickets',9]]);assert.equal(lineLanes(alone),null);
  assert.deepEqual(lineDevs(bare).map(d=>[d.n,d.tool,d.label,d.ids.length]),[[1,null,'',9]]);assert.equal(lineLanes(bare),null);assert.deepEqual(lineDevs(null).map(d=>d.ids),[[]]);
  // A ticket the plan does not name (a fix added later) is one of Dev 1; a plan whose tickets are all of Dev 2 has one dev.
  const added=jir41('analysing');added.tickets.push(row('PRB-160',null));
  assert.deepEqual(lineDevs(lineTickets(added)).map(d=>d.ids.length),[7,3]);
  const only=lineTickets(jir41('analysing',{},t=>t,IDS));
  assert.deepEqual(lineDevs(only).map(d=>[d.n,d.name,d.ids.length]),[[1,'Dev 1',9]]);assert.equal(devCount(jir41('analysing',{},t=>t,IDS)),1);
});

test('screen 41: the two lanes stand where the mockup draws them, each card in the lane of its dev at its place in the order of the plan',()=>{
  const m=jir41('building',AT_41),tickets=lineTickets(m),at=lanesPan({tickets,width:W41,focus:lineFocus(tickets)});
  assert.deepEqual([at.pan,at.auto,at.max,at.lanes,at.active,at.before,at.after],[339,339,678,[339,339],[-1,4],3,3],'PRB-146 at the centre of its lane; the lane of Dev 1, without an active ticket, keeps the place of the mockup');
  const d=lanesLayout({tickets,phases:linePhases(m,tickets),width:W41,pans:at.lanes});
  assert.deepEqual(d.cards.map(c=>[c.id,c.x,c.y,c.w,c.h]),[['PRB-142',-243,40,150,182],['PRB-144',-83,40,150,182],['PRB-149',77,40,150,182],['PRB-145',237,254,150,182],['PRB-146',397,254,150,182],['PRB-147',557,254,150,182],['PRB-150',717,40,150,182],['PRB-151',877,40,150,182],['PRB-148',1037,40,150,182]]);
  const zone=W41-TWO.pin-14-TWO.left,centre=TWO.left+zone/2;
  assert.ok(Math.abs(d.cards[4].x+TWO.card/2-centre)<=0.5,'the active ticket is at the centre of the zone, to the point');
  // QA at the end of the lane of Dev 1, Sign-off at the end of the lane of Dev 2, and the arrow from one to the other.
  assert.deepEqual(d.ends,[{key:'qa',...box(862,40,150,182)},{key:'signoff',...box(862,254,150,182)}]);
  assert.deepEqual([d.segs.filter(s=>s.pin).map(({x,y,w,h})=>({x,y,w,h})),d.heads.filter(h=>h.pin).map(h=>[h.x,h.y,h.dir])],[[box(936,222,2,27)],[[932,247,'down']]]);
  // The backgrounds of the lanes, and where the name of each dev stands.
  assert.deepEqual(d.lanes,[{...box(0,36,850,190),name:{x:8,y:46,w:82}},{...box(0,250,850,190),name:{x:8,y:260,w:82}}]);
  // The phases above, by the order of the plan; « Validate » above QA.
  assert.deepEqual(d.phases.map(p=>[p.x,p.w,p.text,p.dashed,p.pin]),[[-243,150,'Mesurer',false,false],[-83,310,'Préparer la base',false,false],[237,470,'Charger par fenêtres',false,false],[717,310,'Alléger, documenter',false,false],[1037,150,'Mesurer',false,false],[862,150,'Validate',true,true]]);
  // An arrow or a dot between two tickets that follow each other in a lane; nothing from a lane to the other.
  assert.deepEqual(d.glyphs.map(g=>[g.x,g.y,g.w,g.text]),[[-93,123,9,'›'],[67,123,9,'›'],[387,337,9,'›'],[547,337,9,'›'],[867,123,9,'·'],[1027,123,9,'›']]);
  // The dependencies, to the point: PRB-149 to PRB-145 and PRB-147 to PRB-150 and PRB-151 between the two lanes, at 238;
  // PRB-150 and PRB-144 to PRB-148 above the lane of Dev 1, at 33 and 27.
  const MOCKUP=[[151,222,2,16],[151,237,162,2],[311,238,2,11],[631,238,2,16],[631,237,162,2],[791,237,162,2],[791,227,2,11],[951,227,2,11],[791,33,2,7],[791,32,287,2],[1076,33,2,2],[-9,27,2,13],[-9,26,1147,2],[1136,27,2,8]].map(r=>box(...r));
  assert.deepEqual(ink(d.segs.filter(s=>!s.pin)),ink(MOCKUP));
  assert.deepEqual(d.heads.filter(h=>!h.pin).map(h=>[h.x,h.y,h.dir]).sort(),[[307,247,'down'],[787,223,'up'],[947,223,'up'],[1072,33,'down'],[1132,33,'down']].sort());
  // The masks: the names of the devs stand on a plain gutter, the end of the zone is plain, both sides fade; one pair
  // of buttons, between the two lanes.
  assert.deepEqual(d.masks,{gutter:box(0,0,92,466),solid:box(850,0,162,466),left:box(92,0,40,466),right:box(810,0,40,466)});
  assert.deepEqual(d.pans,{before:{x:96,y:226,count:3},after:{x:766,y:226,count:3}});
});

test('screen 40: in Prepare the two lanes start at the first ticket, as the mockup',()=>{
  const m=jir41('analysing'),tickets=lineTickets(m),at=lanesPan({tickets,width:W41,focus:lineFocus(tickets)});
  assert.deepEqual([at.pan,at.lanes,at.active,at.before,at.after],[0,[0,0],[-1,-1],0,5]);
  const d=lanesLayout({tickets,phases:linePhases(m,tickets),width:W41,pans:at.lanes});
  assert.deepEqual(d.cards.map(c=>[c.x,c.y]),[[96,40],[256,40],[416,40],[576,254],[736,254],[896,254],[1056,40],[1216,40],[1376,40]]);
  assert.deepEqual([d.masks.left,d.masks.right,d.pans],[null,box(810,0,40,466),{before:null,after:{x:766,y:226,count:5}}]);
  assert.deepEqual(d.phases.map(p=>[p.x,p.w]),[[96,150],[256,310],[576,470],[1056,310],[1376,150],[862,150]]);
  assert.deepEqual(ink(d.segs.filter(s=>!s.pin)),ink([[490,222,2,16],[490,237,162,2],[650,238,2,11],[970,238,2,16],[970,237,162,2],[1130,237,162,2],[1130,227,2,11],[1290,227,2,11],[1130,33,2,7],[1130,32,287,2],[1415,33,2,2],[330,27,2,13],[330,26,1147,2],[1475,27,2,8]].map(r=>box(...r))));
  // While the Lead still breaks the issue down, QA and Sign-off are left out, the lanes keeping their place.
  const bare=lanesLayout({tickets,width:W41,pans:[0,0],ends:false});
  assert.deepEqual([bare.ends,bare.segs.filter(s=>s.pin),bare.phases.filter(p=>p.pin),bare.lanes.map(l=>l.w)],[[],[],[],[850,850]]);
});

test('each lane is set on its own active ticket (decision 53); a lane without one keeps the place of the mockup',()=>{
  // Dev 1 on PRB-150 while Dev 2 is on PRB-146: each lane at the centre on its ticket.
  const both=lineTickets(jir41('building',{...AT_41,'PRB-150':'review'})),at=lanesPan({tickets:both,width:W41,focus:lineFocus(both)});
  assert.deepEqual([at.active,at.lanes],[[6,4],[659,339]]);
  const d=lanesLayout({tickets:both,phases:linePhases(jir41('building'),both),width:W41,pans:at.lanes}),centre=TWO.left+(W41-TWO.pin-14-TWO.left)/2;
  for(const i of [4,6])assert.ok(Math.abs(d.cards[i].x+TWO.card/2-centre)<=0.5,'ticket '+(i+1)+' at the centre of its lane');
  assert.deepEqual(d.cards.map(c=>c.x),[-563,-403,-243,237,397,557,397,557,717],'the cards of a lane move with their lane alone');
  // A line from a lane to the other still joins its two cards, each where its lane stands: PRB-147 (Dev 2) to PRB-150 (Dev 1).
  const up=d.heads.find(h=>h.dir==='up'&&h.x===d.cards[6].x+75-5);
  assert.deepEqual([up.y,d.segs.some(s=>s.w===2&&s.x===d.cards[5].x+75-1&&s.y===238&&s.h===16),d.segs.some(s=>s.h===2&&s.y===237&&s.x===d.cards[6].x+75-1&&s.w===d.cards[5].x-d.cards[6].x+2)],[223,true,true]);
  // The phases stay in one row, as on the mockup, each above its own tickets; a run is cut where it changes lane. No two
  // titles ever stand on each other (review of the screen): the titles of the lane of Dev 1, which the row stands on,
  // are whole, and one of the lane of Dev 2 keeps the room they leave: « Charger par fenêtres » stops before « Alléger,
  // documenter », above PRB-145. QA and Sign-off do not move.
  const titles=d.phases.filter(p=>!p.pin);
  assert.deepEqual(titles.map(p=>[p.text,p.x,p.w]),[['Mesurer',-563,150],['Préparer la base',-403,310],['Charger par fenêtres',237,150],['Alléger, documenter',397,310],['Mesurer',717,150]]);
  for(const a of titles)for(const b of titles)if(a!==b)assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x,a.text+' over '+b.text);
  assert.deepEqual(d.ends.map(e=>[e.x,e.y]),[[862,40],[862,254]]);
  // A title that has no room left is not drawn rather than drawn over another: Dev 2 on PRB-147 while Dev 1 is on PRB-149.
  const tight=lineTickets(jir41('building',{'PRB-142':'accepted','PRB-144':'accepted','PRB-149':'fix','PRB-145':'accepted','PRB-146':'accepted','PRB-147':'dev'})),t2=lanesPan({tickets:tight,width:W41,focus:lineFocus(tight)});
  const d2=lanesLayout({tickets:tight,phases:linePhases(jir41('building'),tight),width:W41,pans:t2.lanes}),shown=d2.phases.filter(p=>!p.pin);
  assert.deepEqual(t2.lanes,[19,499]);
  for(const a of shown)for(const b of shown)if(a!==b)assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x,a.text+' over '+b.text);
  assert.ok(shown.every(p=>p.w>=TWO.fade),'never a sliver of a title');
  // Each side counts the cards that are really hidden or cut there, lane by lane (review of the screen): PRB-142, PRB-144
  // and PRB-149 before, PRB-148 after. Not what the lane that hides most would hide if it held every ticket.
  const edge=W41-TWO.pin-14;
  assert.deepEqual([d.cards.filter(c=>c.x<TWO.left).map(c=>c.id),d.cards.filter(c=>c.x+c.w>edge).map(c=>c.id)],[['PRB-142','PRB-144','PRB-149'],['PRB-148']]);
  assert.deepEqual([d.pans.before.count,d.pans.after.count],[3,1]);
  assert.deepEqual([d2.pans.before?.count,d2.pans.after?.count],[d2.cards.filter(c=>c.x<TWO.left).length,d2.cards.filter(c=>c.x+c.w>edge).length]);
  // Dev 1 alone at work (PRB-144): the lane of Dev 2 follows, as the mockup moves the two as one.
  const first=lineTickets(jir41('building',{'PRB-142':'accepted','PRB-144':'fix'})),a1=lanesPan({tickets:first,width:W41,focus:lineFocus(first)});
  assert.deepEqual([a1.active,a1.lanes[0]===a1.lanes[1],a1.lanes[0]],[[1,-1],true,-141],'the centring leaves room before the first tickets rather than holding back');
  // Every state a ticket in hand can be in counts as active; an accepted or a waiting one does not.
  for(const state of ['dev','fix','review'])assert.deepEqual(lanesPan({tickets:lineTickets(jir41('building',{'PRB-145':state})),width:W41}).active,[-1,3],state);
  assert.deepEqual(lanesPan({tickets:lineTickets(jir41('building',{'PRB-145':'accepted'})),width:W41,focus:4}).active,[-1,-1]);
  // Nothing in hand (between two tickets): the two lanes on the next ticket, as far as the ends allow, as the line does.
  const idle=lineTickets(jir41('building',{'PRB-142':'accepted','PRB-144':'accepted','PRB-149':'accepted','PRB-145':'accepted'})),a2=lanesPan({tickets:idle,width:W41,focus:lineFocus(idle)});
  assert.deepEqual([lineFocus(idle),a2.lanes],[4,[339,339]]);
  assert.deepEqual(lanesPan({tickets:[],width:W41}).lanes,[0,0]);
});

test('choosing a ticket does not move the lanes; once moved by the user they go together, and a button brings them back on the active ticket',()=>{
  const m=jir41('building',AT_41),tickets=lineTickets(m),auto=lanesPan({tickets,width:W41,focus:4});
  // A ticket chosen: the same places, its links in colour, what it waits for and what it unblocks circled.
  const plain=lanesLayout({tickets,width:W41,pans:auto.lanes}),chosen=lanesLayout({tickets,width:W41,pans:auto.lanes,sel:'PRB-147'});
  assert.deepEqual(chosen.cards.map(c=>[c.x,c.y]),plain.cards.map(c=>[c.x,c.y]));
  assert.deepEqual(chosen.cards.map(c=>c.ring),[null,null,null,null,'waits',null,'unblocks','unblocks',null]);
  assert.deepEqual(chosen.cards.map(c=>c.sel),[false,false,false,false,false,true,false,false,false]);
  assert.deepEqual(chosen.glyphs.map(g=>g.tone),[null,null,null,'waits',null,null]);
  assert.deepEqual(ink(chosen.segs.filter(s=>s.tone==='unblocks')),ink([[631,238,2,16],[631,237,322,2],[791,227,2,11],[951,227,2,11]].map(r=>box(...r))),'the lines of PRB-147 to the two tickets it unblocks');
  assert.ok(chosen.segs.findIndex(s=>s.tone)>chosen.segs.findLastIndex(s=>!s.tone),'a line in colour is drawn over the grey ones');
  assert.deepEqual(chosen.heads.filter(h=>h.tone).map(h=>[h.x,h.y,h.dir,h.tone]).sort(),[[787,223,'up','unblocks'],[947,223,'up','unblocks']]);
  // The buttons move by three tickets and stop on the active ticket; moved, the two lanes go together.
  assert.equal(TWO.step*TWO.pitch,480);
  const moved=lanesPan({tickets,width:W41,focus:4,pan:0});
  assert.deepEqual([moved.pan,moved.lanes,moved.auto,moved.before,moved.after],[0,[0,0],339,0,5]);
  assert.equal(lineJump({pan:0,auto:moved.auto,max:moved.max,by:TWO.step*TWO.pitch}),339,'« N after » stops on the active ticket');
  assert.equal(lineJump({pan:678,auto:339,max:678,by:-TWO.step*TWO.pitch}),339);
  assert.deepEqual(lanesPan({tickets,width:W41,focus:4,pan:9999}).lanes,[678,678],'never beyond the last ticket');
  // Two active tickets: moved, the lanes go together; back on the place of the first lane, each takes its own again.
  const both=lineTickets(jir41('building',{...AT_41,'PRB-150':'review'}));
  assert.deepEqual(lanesPan({tickets:both,width:W41,pan:500}).lanes,[500,500]);
  assert.deepEqual(lanesPan({tickets:both,width:W41,pan:null}).lanes,[659,339]);
});

test('the dependencies of any plan with two devs find their way: between the lanes, over a lane, under the other',()=>{
  const t=(id,n,dev,deps=[])=>({id,n,title:id,dev,model:null,deps,state:'todo',kind:'work',delivery:'included'}),planned=rows=>({tickets:rows,plan:{format:2,tickets:rows.map(r=>({id:r.id,rank:r.n,...(r.dev==='y'?{dev:2}:{})}))}});
  // A waits for nothing; B (Dev 2) waits for A; C (Dev 1) waits for B and D; D (Dev 2); E (Dev 2) waits for B (a jump in its lane).
  const tickets=lineTickets(planned([t('A',1,'x'),t('B',2,'y',['A']),t('D',3,'y'),t('C',4,'x',['B','D']),t('E',5,'y',['B'])])),d=lanesLayout({tickets,width:W41,pans:[0,0]});
  assert.deepEqual(d.cards.map(c=>[c.id,c.lane,c.x]),[['A',0,96],['B',1,256],['D',1,416],['C',0,576],['E',1,736]]);
  // A to B: from the bottom of A, at 238, into the top of B; B receives in its middle only if nothing leaves there: B
  // sends a line to C from its top, so the arrow of A lands 40 from its left.
  assert.ok(d.heads.some(h=>h.dir==='down'&&h.x===256+40-5&&h.y===253-6));
  // Two tickets of Dev 2 into C: two arrows under C, 40 and 100 from its left, and two ways between the lanes since
  // their lines would run over each other.
  assert.deepEqual(d.heads.filter(h=>h.dir==='up'&&h.y===223).map(h=>h.x).sort((a,b)=>a-b),[576+40-5,576+100-5]);
  const ways=[...new Set(d.segs.filter(s=>s.h===2&&s.y>225&&s.y<250).map(s=>s.y+1))].sort();
  assert.deepEqual(ways,[232,238],'a second way is taken, beside the one of the mockup');
  // B to E, in the lane of Dev 2, over D: a rail under the lane, an arrow up into the bottom of E.
  assert.ok(d.segs.some(s=>s.h===2&&s.y===442&&s.x===256+75-1&&s.w===736+75-(256+75)+2));
  assert.ok(d.heads.some(h=>h.dir==='up'&&h.x===736+75-5&&h.y===437));
  // No arrow nor dot between two tickets of two lanes; a dot between B and D, which follow each other without a link.
  assert.deepEqual(d.glyphs.map(g=>[g.x,g.text]),[[406,'·']]);
  // A plan whose rails are all taken still draws every dependency.
  const many=lineTickets(planned([t('A',1,'x'),t('B',2,'x'),t('C',3,'x'),t('D',4,'x',['A']),t('E',5,'x',['A','B']),t('F',6,'x',['A','B','C']),t('G',7,'y')]));
  assert.equal(lanesLayout({tickets:many,width:W41,pans:[0,0]}).heads.filter(h=>!h.pin).length,6);
});

test('the head of the plan names the two devs, each with its tool and its model; the banner starts « the devs » and names the dev of the first ticket',()=>{
  const m=jir41('analysing'),head=lineHead({mission:m,lead});
  assert.deepEqual([head.count,head.facts.line,head.facts.branch,head.facts.devs],['9 tickets','one at a time on','prb-41',[{badge:'D1',name:'Dev 1',tool:'Codex · gpt-6.1-sol'},{badge:'D2',name:'Dev 2',tool:'Claude Code · opus 5.5'}]]);
  const ready=pageBand({mission:m,lead,items:[]});
  assert.deepEqual([ready.tone,ready.det,ready.button.label],['ok','No open question · first ticket PRB-142 with Dev 1','Approve and start the devs']);
  // The first ticket of a plan is said with the dev the plan gives it, whatever its tool.
  const swapped=jir41('analysing',{},t=>({...t,...toolOf(t.id,['PRB-142'])}));
  assert.equal(pageBand({mission:swapped,lead,items:[]}).det,'No open question · first ticket PRB-142 with Dev 1');
  assert.equal(pageBand({mission:jir41('analysing',{},t=>t,['PRB-142']),lead,items:[]}).det,'No open question · first ticket PRB-142 with Dev 2');
  // Two devs of one tool: the same banner, and a question of the dev of PRB-146 is still one « from Dev 2 ».
  const twins=sameTool('building',AT_41),ask={id:'q2',type:'decision',state:'pending',mission:'M-1',ticket:'PRB-146',from:'dev',title:'Question ?',answers:['oui','non']};
  assert.equal(pageBand({mission:sameTool('analysing'),lead,items:[]}).button.label,'Approve and start the devs');
  assert.equal(pageBand({mission:twins,lead,items:[ask]}).big,'Waiting on you: a question from Dev 2 on PRB-146');
  assert.equal(pageAnswer({item:ask,mission:twins,tickets:lineTickets(twins),asks:[ask]}).kicker,'Question from Dev 2 · yours to answer');
  assert.equal(pageAnswer({item:{...ask,ticket:'PRB-150'},mission:twins,tickets:lineTickets(twins),asks:[ask]}).kicker,'Question from Dev 1 · yours to answer');
  const T0=Date.parse('2026-11-13T15:00:00Z'),asked=pageBand({mission:{...m,launchAskedAt:new Date(T0-30000).toISOString()},lead:{...lead,status:'working'},items:[],now:T0});
  assert.deepEqual([asked.tone,asked.big,asked.det,asked.button],['run','Starting the devs…','Dev 1 is starting',undefined]);
  const alone=pageBand({mission:{...one('analysing'),launchAskedAt:new Date(T0-30000).toISOString()},lead:{...lead,status:'working'},items:[],now:T0});
  assert.deepEqual([alone.big,alone.det],['Starting the dev…','Dev 1 is starting'],'one dev: the banner of before');
  // In Develop the banner is the one of one dev; a question of the dev of PRB-146 is one « from Dev 2 ».
  const dev=jir41('building',AT_41),item={id:'q',type:'decision',state:'pending',mission:'M-1',ticket:'PRB-146',from:'dev',title:'Question ?',answers:['oui','non']};
  assert.deepEqual([pageBand({mission:dev,lead,items:[]}).big,pageBand({mission:dev,lead,items:[]}).det],['On track: PRB-146 in dev','4 of 9 accepted · nothing is waiting on you']);
  assert.equal(pageBand({mission:dev,lead,items:[item]}).big,'Waiting on you: a question from Dev 2 on PRB-146');
  assert.equal(pageAnswer({item,mission:dev,tickets:lineTickets(dev),asks:[item]}).kicker,'Question from Dev 2 · yours to answer');
  // The sheet of the approach names both devs.
  const sheet=pageSheet({mission:{...m,plan:{...m.plan,approach:{paragraphs:['Un paragraphe.']}}},tickets:lineTickets(m),lead,open:{t:'approach'}});
  assert.deepEqual(sheet.parts.find(p=>p.kind==='pairs').rows.find(r=>r[0]==='Devs'),['Devs','Dev 1 (Codex · gpt-6.1-sol), Dev 2 (Claude Code · opus 5.5)']);
});

test('« Who\'s working » has a line for each dev, to the letter (screen 41): the one at rest says its next ticket, its tool and its model',()=>{
  const m=jir41('building',AT_41),tickets=lineTickets(m),devs=lineLanes(tickets),now=Date.parse('2026-11-13T17:40:00Z'),started={t3:new Date(now-38*60000).toISOString()};
  const workers=pageWorkers({mission:m,lead,agents:[tab('t1','Lead · PRB-41','idle'),tab('t3','PRB-146 · dev')],items:[],started,space:'sp',now,devs});
  assert.deepEqual(workers.map(w=>[w.key,w.badge,w.name,w.tool,w.what,w.dim,w.address,w.ticket]),[
    ['dev','D1','Dev 1','Codex · gpt-6.1-sol','next ticket: PRB-150',true,null,null],
    ['dev-2','D2','Dev 2','Claude Code · opus 5.5','PRB-146 · in dev for 38 min',false,'t3','PRB-146']]);
  assert.deepEqual(pageTabs(workers,lead).map(t=>t.label),["Lead's tab","Dev 2's tab"]);
  // The time the engine gives for the ticket in hand is the one of its dev only.
  const both=jir41('building',{...AT_41,'PRB-150':'dev'}),w2=pageWorkers({mission:both,lead,agents:[tab('t2','PRB-150 · dev'),tab('t3','PRB-146 · dev')],items:[],started:{t2:new Date(now-5*60000).toISOString(),...started},space:'sp',now,devs,took:'41 min'});
  assert.deepEqual(w2.map(w=>[w.name,w.what,w.ticket]),[['Dev 1','PRB-150 · in dev for 5 min','PRB-150'],['Dev 2','PRB-146 · in dev for 41 min','PRB-146']],'the ticket in hand of the page is the first of the plan: PRB-146');
  // The time of each ticket in hand is the one of its own dev (review of the screen: the card of Dev 2 took the time of
  // Dev 1). Without a time from the engine: Dev 1 for 5 min on PRB-150, Dev 2 for 38 min on PRB-146, which is the ticket
  // in hand of the page since it comes first in the plan.
  const spans=pageSpans({hand:both.tickets.find(t=>t.id==='PRB-146'),tickets:lineTickets(both),workers:pageWorkers({mission:both,lead,agents:[tab('t2','PRB-150 · dev'),tab('t3','PRB-146 · dev')],items:[],started:{t2:new Date(now-5*60000).toISOString(),...started},space:'sp',now,devs}),story:{},started:{t2:new Date(now-5*60000).toISOString(),...started},now});
  assert.deepEqual(spans.spans,{'PRB-150':'5 min','PRB-146':'38 min'});
  // The time the engine gives for a step comes first, for the ticket it is given for and no other.
  const timed=pageSpans({hand:both.tickets.find(t=>t.id==='PRB-146'),tickets:lineTickets(both),workers:w2,story:{timings:{'PRB-146':[{step:'dev',minutes:41}]}},started:{t2:new Date(now-5*60000).toISOString(),...started},took:'41 min',now});
  assert.deepEqual(timed.spans,{'PRB-150':'5 min','PRB-146':'41 min'});
  // A ticket in hand whose dev does not run (in review) takes no time from the terminal of the other dev.
  const rev=jir41('building',{...AT_41,'PRB-146':'review','PRB-150':'dev'}),wr=pageWorkers({mission:rev,lead,agents:[tab('t2','PRB-150 · dev'),tab('t3','PRB-146 · dev','idle')],items:[],started:{t2:new Date(now-5*60000).toISOString()},space:'sp',now,devs});
  assert.deepEqual(pageSpans({hand:rev.tickets.find(t=>t.id==='PRB-146'),tickets:lineTickets(rev),workers:wr,story:{},started:{t2:new Date(now-5*60000).toISOString()},now}).spans,{'PRB-150':'5 min'});
  // One dev: the time of the ticket in hand, from the engine first, else from the terminal of the dev, as before.
  const m1=one('building',AT_41),w1=pageWorkers({mission:m1,lead,agents:[tab('t2','PRB-146 · dev')],items:[],started:{t2:new Date(now-38*60000).toISOString()},space:'sp',now});
  assert.deepEqual(pageSpans({hand:m1.tickets[4],tickets:lineTickets(m1),workers:w1,story:{},started:{t2:new Date(now-38*60000).toISOString()},now}),{span:'38 min',spans:{'PRB-146':'38 min'}});
  assert.deepEqual(pageSpans({hand:m1.tickets[4],tickets:lineTickets(m1),workers:w1,story:{},started:{t2:new Date(now-38*60000).toISOString()},took:'52 min',now}),{span:'52 min',spans:{'PRB-146':'52 min'}});
  assert.deepEqual(pageSpans({hand:null,tickets:[],workers:[],story:null,started:{},now}),{span:'',spans:{}});
  // Two devs of one tool: each line has its own tickets and its own tab, the tool of both said under each name.
  const sm=sameTool('building',{...AT_41,'PRB-150':'dev'}),sd=lineLanes(lineTickets(sm)),ws=pageWorkers({mission:sm,lead,agents:[tab('t2','PRB-150 · dev'),tab('t3','PRB-146 · dev')],items:[],started:{t2:new Date(now-5*60000).toISOString(),...started},space:'sp',now,devs:sd});
  assert.deepEqual(ws.map(w=>[w.key,w.name,w.tool,w.what,w.address,w.ticket]),[['dev','Dev 1','Codex · gpt-6.1-sol','PRB-150 · in dev for 5 min','t2','PRB-150'],['dev-2','Dev 2','Codex · gpt-6.1-sol','PRB-146 · in dev for 38 min','t3','PRB-146']]);
  // A ticket of Dev 2 in review: its dev waits, Dev 1 says its next ticket; the reviewer has its own line.
  const review=jir41('building',{...AT_41,'PRB-146':'review'}),w3=pageWorkers({mission:review,lead,agents:[tab('t3','PRB-146 · dev','idle'),tab('t4','PRB-146 · revue 1')],items:[],started:{},space:'sp',now,devs});
  assert.deepEqual(w3.map(w=>[w.name,w.what]),[['Dev 1','next ticket: PRB-150'],['Dev 2','PRB-146 is in review'],['Reviewer','PRB-146 is in review · review 1']]);
  // Each dev done says so.
  const done=jir41('building',Object.fromEntries(IDS.map(id=>[id,SECOND.includes(id)?'accepted':'todo']))),w4=pageWorkers({mission:done,lead,agents:[],items:[],started:{},space:'sp',now,devs});
  assert.deepEqual(w4.filter(w=>w.kind==='dev').map(w=>[w.name,w.what]),[['Dev 1','next ticket: PRB-142'],['Dev 2','done with its tickets']]);
});

test('with two devs no band is drawn under the lanes: the steps of the ticket in hand and the tokens go to the column (screen 41)',()=>{
  const m=jir41('building',AT_41),tickets=lineTickets(m);
  assert.equal(pageStrip({mission:m,tickets,lead,items:[],reports:[],story:{},span:'38 min'}),null);
  assert.equal(pageStrip({mission:jir41('analysing'),tickets:lineTickets(jir41('analysing')),lead,items:[],story:{}}),null,'nor in Prepare');
  const current=pageCurrent({mission:m,tickets,items:[],reports:[],story:{},spans:{'PRB-146':'38 min'}});
  assert.deepEqual(current,[{id:'PRB-146',title:'Current ticket · PRB-146 · time per step',steps:[
    {sign:'●',tone:'run',text:'In dev · Dev 2',sub:'running',time:'38 min'},{sign:'·',tone:null,text:'Review 1',sub:'up next',time:''},{sign:'·',tone:null,text:'Review 2',sub:'up next',time:''}]}]);
  // The time the engine gives for a step comes before the one of the terminal; nothing in hand, nothing said.
  assert.equal(pageCurrent({mission:m,tickets,story:{timings:{'PRB-146':[{step:'dev',minutes:52}]}},spans:{'PRB-146':'38 min'}})[0].steps[0].time,'52 min');
  assert.deepEqual(pageCurrent({mission:jir41('analysing'),tickets:lineTickets(jir41('analysing'))}),[]);
  assert.deepEqual(pageCurrent({mission:jir41('building',{...AT_41,'PRB-146':'accepted'}),tickets:lineTickets(jir41('building',{...AT_41,'PRB-146':'accepted'}))}),[]);
  // The tokens of the issue: the sum of what each agent used, one line for each, the devs under their names.
  const agents=[{role:'lead',in:236000,out:24400},{role:'dev',tool:'codex',in:605000,out:42300},{role:'dev',tool:'claude',in:727000,out:63200},{role:'reviewer',in:518000,out:26100}],tokens=pageTokens({story:{tokens:{agents}},tickets});
  assert.deepEqual([tokens.title,tokens.in,tokens.inWord,tokens.out,tokens.outWord,tokens.note],['Token usage · this issue','2.1M','in','156k','out','since Prepare started · updates live']);
  assert.deepEqual(tokens.rows.map(r=>[r.name,r.in,r.out,Math.max(2,Math.round(110*r.part))]),[['Lead','236k in','24k out',36],['Dev 1','605k in','42k out',92],['Dev 2','727k in','63k out',110],['Reviewers','518k in','26k out',78]]);
  // A dev is named by its number (`dev`), as in the plan: two devs of one tool keep each its own tokens. Named by a tool
  // that two devs share, a line belongs to neither: it is drawn under « Devs · Codex » and counted in the total, never
  // given to the first (M13 display review 1).
  const twins=lineTickets(sameTool('building',AT_41)),byDev=[{role:'dev',dev:1,in:605000,out:42300},{role:'dev',dev:2,tool:'codex',in:727000,out:63200}];
  assert.deepEqual(pageTokens({story:{tokens:{agents:byDev}},tickets:twins}).rows.map(r=>[r.name,r.in]),[['Dev 1','605k in'],['Dev 2','727k in']]);
  assert.deepEqual(pageTokens({story:{tokens:{agents:byDev}},tickets}).rows.map(r=>[r.name,r.in]),[['Dev 1','605k in'],['Dev 2','727k in']],'the number comes before the tool');
  const shared=pageTokens({story:{tokens:{estimate:true,agents:[agents[0],{role:'dev',tool:'codex',in:605000,out:42300}]}},tickets:twins});
  assert.deepEqual(shared.rows.map(r=>[r.name,r.in,r.out]),[['Lead','≈ 236k in','≈ 24k out'],['Devs · Codex','≈ 605k in','≈ 42k out']]);
  assert.deepEqual([shared.in,shared.out],['≈ 841k','≈ 67k'],'Lead 236k + devs 605k');
  const lost=pageTokens({story:{tokens:{estimate:true,agents:[agents[0],{role:'dev',tool:'codex',in:null,out:null}]}},tickets:twins});
  assert.deepEqual(lost.rows.map(r=>[r.name,r.in,r.out,r.part]),[['Lead','≈ 236k in','≈ 24k out',1],['Devs · Codex','Unknown in','Unknown out',null]]);
  assert.deepEqual([lost.in,lost.out],['Unknown','Unknown'],'a shared line unknown: the total too');
  // Beside the lines of each dev, the shared line stays its own, added to the total once.
  const both=pageTokens({story:{tokens:{agents:[{role:'dev',dev:1,in:100000,out:1000},{role:'dev',tool:'codex',in:50000,out:500}]}},tickets:twins});
  assert.deepEqual([both.rows.map(r=>[r.name,r.in]),both.in,both.out],[[['Dev 1','100k in'],['Devs · Codex','50k in']],'150k','2k']);
  assert.deepEqual(pageTokens({story:{tokens:{agents:[{role:'dev',dev:2,in:1,out:1},{role:'dev',dev:1,in:5000,out:1}]}},tickets:lineTickets(one('building',AT_41))}).rows.map(r=>r.name),['Dev 1'],'one dev: no Dev 2');
  // What the engine does not count is not drawn: no agent, no block; an agent it does not name, or a tool no dev has, no line.
  assert.equal(pageTokens({story:{tokens:{tickets:{'PRB-146':{in:1,out:1}}}},tickets}),null);assert.equal(pageTokens({story:null,tickets}),null);
  assert.deepEqual(pageTokens({story:{tokens:{agents:[{role:'pilot',in:1,out:1},{role:'dev',tool:'gemini',in:1,out:1},{role:'qa',in:31000,out:1400},{role:'lead',in:'x',out:1}]}},tickets}).rows.map(r=>r.name),['QA agent']);
});

test('the card and the details of a ticket say the dev of its lane; the rest of the page keeps working with two devs',()=>{
  const m=jir41('building',AT_41),tickets=lineTickets(m),card=lineCard(tickets[4],{stage:'develop',span:'38 min',dev:lineDev(tickets,tickets[4])});
  assert.deepEqual([card.word,card.sub,card.avatar],['In dev','38 min',{text:'D2',live:true}]);
  const detail=lineDetail({mission:m,tickets,id:'PRB-146',span:'38 min'}),other=lineDetail({mission:m,tickets,id:'PRB-150'});
  assert.deepEqual([detail.position,detail.dev,detail.timeline.steps[0].text],['Ticket 5 of 9','Dev 2 · Claude Code · opus 5.5 · high effort','In dev · Dev 2']);
  assert.equal(other.dev,'Dev 1 · Codex · gpt-6.1-sol · high effort');
  assert.deepEqual([other.waits.ids,other.unblocks.ids],[['PRB-147'],['PRB-148']]);
});

test('one dev: nothing of the line changes, to the point',()=>{
  // The numbers of the line are those of before the lanes.
  assert.deepEqual({...LINE},{card:160,gap:10,pitch:170,left:4,top:40,height:196,pin:150,pinHeight:94,pinGap:8,row:272,band:278,host:466,fade:40,step:3,pans:244});
  const m=one('building',AT_41),tickets=lineTickets(m),at=linePan({count:9,width:966,focus:lineFocus(tickets),active:lineActive(tickets)});
  assert.deepEqual([at.view,at.max,at.pan,at.auto,at.before,at.after],[798,722,361,361,3,3]);
  const d=lineLayout({tickets,phases:linePhases(m,tickets),width:966,pan:at.pan});
  assert.deepEqual(d.cards.map(c=>[c.x,c.y,c.w,c.h]),IDS.map((_id,i)=>[4+i*170-361,40,160,196]));
  assert.deepEqual(d.ends,[{key:'qa',...box(816,40,150,94)},{key:'signoff',...box(816,142,150,94)}]);
  assert.deepEqual([Object.keys(d).sort(),Object.keys(d.masks).sort()],[['cards','ends','glyphs','heads','masks','pans','phases','segs'],['left','right','solid']],'no lane, no gutter');
  assert.deepEqual(d.pans,{before:{x:4,y:244,count:3},after:{x:720,y:244,count:3}});
  // The head, the workers and the band are those of one dev, with or without the devs told.
  const head=lineHead({mission:one('analysing'),lead});
  assert.deepEqual([head.facts.dev,head.facts.devs],[{badge:'D1',name:'Dev 1',tool:'Claude Code · opus 5.5'},[{badge:'D1',name:'Dev 1',tool:'Claude Code · opus 5.5'}]]);
  const now=Date.parse('2026-11-13T17:40:00Z'),args={mission:m,lead,agents:[tab('t2','PRB-146 · dev')],items:[],started:{t2:new Date(now-38*60000).toISOString()},space:'sp',now};
  const plain=pageWorkers(args);
  assert.deepEqual(plain,[{key:'dev',kind:'dev',badge:'D1',name:'Dev 1',tool:'Claude Code · opus 5.5',what:'PRB-146 · in dev for 38 min',address:'t2',dim:false,warn:false}]);
  assert.deepEqual(pageWorkers({...args,devs:lineLanes(tickets)}),plain);assert.deepEqual(pageWorkers({...args,devs:lineDevs(tickets)}),plain);
  const ready=pageBand({mission:one('analysing'),lead,items:[]});
  assert.deepEqual([ready.det,ready.button.label],['No open question · first ticket PRB-142 with Dev 1','Approve and start the dev']);
  // The band under the line is still drawn, and the column gets nothing more.
  assert.equal(pageStrip({mission:m,tickets,lead,items:[],reports:[],story:{},span:'38 min'}).kicker,'Current ticket · PRB-146 · 5 of 9');
  assert.equal(lineLanes(tickets),null);
});
