import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const MODS=['fabrique-console-v3-bar','fabrique-console-v3-top','fabrique-console-v3-inbox','fabrique-console-v3-my-issues','fabrique-console-v3-agent','fabrique-console-v3-issues','fabrique-console-v3-issue'];
// Each layout is one page: the bar and the top bar know which.
const LAYOUTS={'fabrique-console-v3-inbox':'inbox','fabrique-console-v3-my-issues':'myIssues','fabrique-console-v3-agent':'agent','fabrique-console-v3-issues':'issues','fabrique-console-v3-issue':'issue'};
const SHARED=['kit.js','texts.js','model.js','view.js','observed.js'];

test('generated copies in the V3 mods match their sources',async()=>{
  const icons=(await readdir(resolve('ui/v3/icons'))).filter(f=>f.endsWith('.svg'));
  assert.ok(icons.length>=6);
  for(const mod of MODS) {
    assert.equal(await readFile(resolve('mods',mod,'common.js'),'utf8'),await readFile(resolve('ui/common.js'),'utf8'),mod+'/common.js is stale: run npm run build:ui');
    for(const file of SHARED) assert.equal(await readFile(resolve('mods',mod,file),'utf8'),await readFile(resolve('ui/v3',file),'utf8'),mod+'/'+file+' is stale: run npm run build:ui');
    for(const icon of icons) assert.equal(await readFile(resolve('mods',mod,'icons',icon),'utf8'),await readFile(resolve('ui/v3/icons',icon),'utf8'),mod+'/icons/'+icon+' is stale');
  }
});

test('every V3 layout is the side bar beside the top bar and one page, with V3 or official mods only',async()=>{
  const used=new Set();
  for(const [name,page] of Object.entries(LAYOUTS)) {
    const layout=JSON.parse(await readFile(resolve('layouts',name+'.json'),'utf8'));
    const mods=[],ids=[];
    (function walk(node){if(!node||typeof node!=='object')return;if(typeof node.id==='string')ids.push(node.id);if(typeof node.mod==='string')mods.push(node.mod);for(const v of Object.values(node))walk(v);})(layout);
    for(const mod of mods) {assert.ok(MODS.includes(mod)||['tabs','pane'].includes(mod),name+' uses '+mod);used.add(mod);}
    assert.equal(new Set(ids).size,ids.length,name+' has a duplicate id');
    assert.equal(layout.type,'row',name);assert.equal(layout.children.length,2,name);
    // No system title bar: the side bar moves the window, the macOS buttons keep their room.
    assert.equal(layout.titlebar,'none',name);assert.deepEqual(layout.traffic_lights,[12,14],name);
    const [bar,body]=layout.children;
    assert.equal(bar.window_drag,true,name);
    assert.equal(bar.id,'fabrique-console-v3-bar');assert.equal(bar.content.mod,'fabrique-console-v3-bar');assert.equal(bar.content.props.page,page);assert.equal(bar.size.px,216,'the side bar of the mockup is 216 px');
    assert.deepEqual(body.size,{weight:1});assert.equal(body.type,'column');
    const [top]=body.children;
    assert.equal(top.content.mod,'fabrique-console-v3-top');assert.equal(top.content.props.page,page);assert.equal(top.size.px,78,'the band of the issue tabs (34 px) above the top bar of the mockup (44 px)');
    assert.equal(body.children.length,2);
    assert.equal(layout.preview,'layouts/'+name+'.svg');
  }
  // The Agent page: its head, then the tabs and the active terminal of the agent space, full width.
  const agent=JSON.parse(await readFile(resolve('layouts/fabrique-console-v3-agent.json'),'utf8'));
  const [head,tabs,terminal]=agent.children[1].children[1].children;
  assert.equal(head.content.mod,'fabrique-console-v3-agent');assert.equal(tabs.content.mod,'tabs');assert.equal(terminal.content.tab,'active');
  // The Issue page: the terminal of the PO (the active tab) on the left, the issue on the right, both under the top bar.
  const issue=JSON.parse(await readFile(resolve('layouts/fabrique-console-v3-issue.json'),'utf8'));
  const [center,side]=issue.children[1].children[1].children;
  assert.equal(center.children[0].content.mod,'tabs');assert.equal(center.children[1].content.tab,'active');
  assert.equal(side.children[0].content.mod,'fabrique-console-v3-issue');
  assert.ok(center.size.weight>side.size.weight,'the terminal takes more than half');
  for(const mod of MODS) assert.ok(used.has(mod),mod+' is in no layout');
});

test('the V3 mods and layouts are the ones listed (the V4 ones stand beside them), and nothing refers to anything else',async()=>{
  const {pageLayouts}=await import('../../../../ui/v3/view.js');
  assert.deepEqual((await readdir(resolve('mods'))).filter(n=>n.startsWith('fabrique-console-')&&!n.startsWith('fabrique-console-v4-')).sort(),[...MODS].sort());
  assert.deepEqual((await readdir(resolve('layouts'))).filter(n=>!n.startsWith('fabrique-console-v4-')).sort(),Object.keys(LAYOUTS).flatMap(n=>[n+'.json',n+'.svg']).sort());
  assert.deepEqual(pageLayouts().sort(),Object.keys(LAYOUTS).sort());
  // The Herdr space of the general assistant and the label of the app are the names that are neither a mod nor a layout.
  const known=new Set([...MODS,...Object.keys(LAYOUTS),'fabrique-console-agent','fabrique-console'].map(n=>"'"+n+"'"));
  for(const file of ['ui/common.js','ui/v3/kit.js','ui/v3/view.js',...MODS.map(m=>'mods/'+m+'/main.js')]) {
    const source=await readFile(resolve(file),'utf8');
    for(const name of source.match(/'fabrique-console-[a-z0-9-]*'/g)||[]) assert.ok(known.has(name),file+' refers to '+name);
  }
});

test('every label of the V3 screens is defined once, in texts.js',async()=>{
  for(const mod of MODS) {
    const source=await readFile(resolve('mods',mod,'main.js'),'utf8');
    const literals=[...source.matchAll(/\.child\('([^']*[a-zà-ÿ]{3,}[^']*)'\)/gi)].map(m=>m[1]);
    assert.deepEqual(literals,[],mod+' draws a hard-coded label');
  }
});

// Deferred states: the app check renders each mod once with seeded live data.
const now=Date.now();
const projects=[{key:'alpha',name:'Alpha',teamId:'team-1',repo:'/example/alpha'},{key:'beta',name:'Beta',teamId:'team-2',repo:'/example/beta'}];
const issue={id:'issue-1',identifier:'XJ-690',title:'Compétitions payantes',description:'## Clarification\n\n**Décidé**\n- Stripe\n\n**Ouvert**\n- Remboursement ?',url:'https://linear.app/example/issue/XJ-690',priority:2,createdAt:new Date(now).toISOString(),state:{id:'st',name:'Backlog',type:'backlog'},team:{id:'team-1'},project:null,labels:[{id:'l1',name:'niveau:standard',color:'#4FAE52'},{id:'l2',name:'Chore'}],assignee:{name:'the user'},comments:[{body:'Commentaire',user:{name:'Demo'}}]};
const po={id:'po-1',role:'po',issueId:'issue-1',identifier:'XJ-690',title:issue.title,tool:'claude',review:false,projectKey:'alpha',repo:'/example/alpha',worktree:null,terminalId:'t1',status:'working',step:'analysis',createdAt:'2026-11-07T10:00:00Z'};
const full={
  snapshot:{projects,sessions:[po,{...po,id:'po-2',issueId:'issue-2',terminalId:'t2',status:'historical'},{...po,id:'po-3',issueId:'issue-3',identifier:'XJ-700',terminalId:'t3',status:'blocked',projectKey:'beta'},{...po,id:'po-4',issueId:'issue-4',identifier:'XJ-701',terminalId:'t4',status:'error',firstMessageSent:false},{...po,id:'po-5',issueId:'issue-5',identifier:'XJ-702',title:'Corriger les scores',terminalId:'t5',status:'idle',question:{id:'q-1',text:'Quel découpage retenir ?',options:['Issue simple','Project'],askedAt:new Date(now-12*60000).toISOString()}},{...po,id:'po-6',issueId:'issue-6',identifier:'XJ-703',terminalId:'t6',status:'working',question:{id:'q-2',text:'Lancer cette Issue avec Claude ?',options:['Lancer'],askedAt:new Date(now-3*60000).toISOString()}},{...po,id:'po-7',issueId:'issue-7',identifier:'XJ-704',terminalId:'t7',status:'working',readyAt:new Date(now-60000).toISOString()}]},
  agents:[{address:'t1',space:'sp1',tab:'tab1',tab_name:'1',status:'working'},{address:'t8',space:'sp-agent',tab:'tab8',tab_name:'fabrique-console-agent-claude',status:'idle'}],
  terminals:[{address:'t8',state:'live',labels:{'fabrique-console.app':'fabrique-console','fabrique-console.role':'agent','fabrique-console.tool':'claude'}}],
  spaces:[{id:'sp-agent',index:1,name:'fabrique-console-agent',named:true,folder:'/example/Developer',active:false,tabs:[]}],
  shared:{'fabrique-console.v3.agent-tool':'claude','fabrique-console.snapshot-at':new Date(now).toISOString(),'fabrique-console.project':'alpha','fabrique-console.issue':'issue-1','fabrique-console.session':'po-1','fabrique-console.v3.issues-filter':'all','fabrique-console.v3.my-issues-tab':'issues','fabrique-console.v3.my-issues-filter':'all','fabrique-console.v3.unfolded':['beta'],'fabrique-console.v3.backlog-count':{key:'alpha',count:3},'fabrique-console.v3.issue-head':{id:'issue-1',identifier:'XJ-690',state:{name:'Backlog',type:'backlog'}}},
  fields:{replying:{session:'po-5',id:'q-1',askedAt:new Date(now-12*60000).toISOString()},wanted:{id:'issue-1',key:'alpha',filter:'all',teamId:'team-1'},ctx:{key:'alpha',teamId:'team-1'},updatedAt:'2026-11-07T12:00:00Z',issue,issues:[issue,{...issue,id:'issue-2',identifier:'XJ-688',assignee:null,labels:[],priority:1},{...issue,id:'issue-3',identifier:'XJ-700',title:'Un titre assez long pour vérifier que la ligne ne casse pas la mise en page de la liste',state:null}],removing:'issue-3',cached:true,updatedAt:'2026-11-07T12:00:00Z',error:'',warning:'La consigne n’a pas été remise.',unfolded:['alpha/p1'],pending:{operationId:'0b5f3b1e-7c2d-4e8a-9f10-2a3b4c5d6e7f',title:'Compétitions payantes',attemptedAt:'2026-11-07T11:00:00Z',key:'alpha',newId:'1c6a4c2f-8d3e-4f9b-8a21-3b4c5d6e7f80'},tracker:{teams:[{key:'alpha',name:'Alpha',projects:[{id:'p1',name:'Médiathèque & images IA',counts:{started:2,backlog:1,completed:4},states:[{name:'In Progress',type:'started',count:2},{name:'Backlog',type:'backlog',count:1},{name:'Done',type:'completed',count:4}],total:7,issues:[{id:'pi1',identifier:'XJ-710',title:'Dépôt des photos',url:'https://linear.app/example/issue/XJ-710',priority:2,state:{name:'In Progress',type:'started'},assignee:{name:'the user'},labels:[{name:'Feature',color:'#8E86F5'},{name:'app'}],updatedAt:new Date(now).toISOString(),parentId:null,blocks:2,blockedBy:0},{id:'pi2',identifier:'XJ-711',title:'Images IA',priority:0,state:{name:'Backlog',type:'backlog'},assignee:null,parentId:'pi1',blocks:0,blockedBy:1},{id:'pi3',identifier:'XJ-712',title:'Vignettes',priority:0,state:{name:'Done',type:'completed'},assignee:null,parentId:'pi1',blocks:0,blockedBy:0}]},{id:'p2',name:'Site vitrine',counts:{completed:6},states:[{name:'Done',type:'completed',count:6}],total:6,issues:[]}]},{key:'beta',name:'Beta',projects:[],error:{code:'TICKET_API',message:'Tracker returned a GraphQL error.'}}],activity:[{id:'pi1',identifier:'XJ-710',title:'Dépôt des photos',url:'https://linear.app/example/issue/XJ-710',state:{name:'In Progress',type:'started'},labels:[{name:'Feature',color:'#8E86F5'}],updatedAt:new Date(now).toISOString(),team:{key:'alpha',name:'Alpha'},project:{id:'p1',name:'Médiathèque & images IA'}},{id:'pi9',identifier:'JI-3',title:'Sans project',state:null,labels:[],updatedAt:new Date(now-3*86400000).toISOString(),team:{key:'beta',name:'Beta'},project:null}],relations:'full',cached:true,updatedAt:'2026-11-07T12:00:00Z'},at:now-120000},
};
const empty={snapshot:{projects,sessions:[]},agents:[],shared:{'fabrique-console.snapshot-at':new Date(now).toISOString(),'fabrique-console.project':'beta'},fields:{wanted:{key:'beta',filter:'backlog'},ctx:{key:'beta',teamId:'team-2'},updatedAt:'2026-11-07T12:00:00Z',issues:[],issue:null}};
const loading={snapshot:{projects:[],sessions:[]},agents:[],shared:{}};
const failing={...full,fields:{...full.fields,error:'Tracker indisponible',issue:null,issues:[]}};
// An Agent terminal Herdr lists but does not report yet: the page renders, and keeps to its own space.
const unreported={...full,agents:[],spaces:[{...full.spaces[0],active:false}]};
const noTeam={snapshot:{projects:[],sessions:[]},agents:[],shared:{'fabrique-console.snapshot-at':new Date(now).toISOString()}};
for(const [label,seed] of [['full',full],['empty',empty],['loading',loading],['in error',failing],['no team',noTeam],['agent unreported',unreported]]) for(const name of MODS) {
  test('native deferred state, '+label+': '+name,{skip:process.env.FABRIQUE_CONSOLE_NATIVE_CHECKS!=='1'},async()=>{
    const scratch=await mkdtemp(join(tmpdir(),'fabrique-console-v3-native-'));const mod=join(scratch,name);
    try{
      await cp(resolve('mods',name),mod,{recursive:true});
      let common=await readFile(join(mod,'common.js'),'utf8');
      const patched=common.replace(/export const snapshot=\(\)=>[^;]+;/,'export const snapshot=()=>('+JSON.stringify(seed.snapshot)+');');
      assert.notEqual(patched,common);
      await writeFile(join(mod,'common.js'),patched);
      let source=await readFile(join(mod,'main.js'),'utf8');
      const seeded={run:'()=>null',props:'()=>({})',shared:'key=>('+JSON.stringify(seed.shared)+')[key]??null',agents:'()=>('+JSON.stringify(seed.agents)+')',setShared:'()=>null',terminals:'()=>('+JSON.stringify(seed.terminals??[])+')',hc:'async()=>({stdout:"{}"})',home:'()=>"/example"',spaces:'()=>('+JSON.stringify(seed.spaces??[])+')',window:'()=>({platform:"macos",titlebar:"none",buttons:false,maximized:false,fullscreen:false,active:true})'};
      source=source.replace(/import \{([^}]*)\} from 'herdr'/g,(_m,imports)=>"import {"+imports.split(',').map(i=>seeded[i.trim()]?i.trim()+' as original_'+i.trim():i).join(',')+"} from 'herdr'");
      for(const [fn,body] of Object.entries(seeded)) if(new RegExp('\\b'+fn+' as original_'+fn+'\\b').test(source)) source+='\nconst '+fn+'='+body+';';
      const match=source.match(/export default class (\w+) extends View/);assert.ok(match);
      source=source.replace('export default class '+match[1]+' extends View','class '+match[1]+' extends View');
      source+='\nexport default class Seeded extends '+match[1]+' { init(p,cx) { super.init?.(p,cx); Object.assign(this,'+JSON.stringify(seed.fields??{})+'); if(Array.isArray(this.unfolded)) this.unfolded=new Set(this.unfolded); } }';
      await writeFile(join(mod,'main.js'),source+'\n');
      const r=spawnSync(process.env.FABRIQUE_CONSOLE_HERDR_APP||join(process.env.HOME,'.local/bin/herdr-app'),['check',mod],{encoding:'utf8',timeout:20000,env:{...process.env,HERDR_APP_HOME:join(scratch,'app')}});
      assert.equal(r.status,0,r.stderr||r.stdout||r.error?.message);
    }finally{await rm(scratch,{recursive:true,force:true});}
  });
}
