import { configV2 } from './config-v2-fixture.mjs';
import { ordinaryDescription,readyLabels } from './qualification-fixture.mjs';
export function qualificationInput(body,{heading=false}={}) {
  const config=configV2();config.projects[0].teamId='team';config.projects[0].projectId='epic';
  const collection=items=>({items,complete:true,total:items.length,reasons:[]});
  const description=heading?ordinaryDescription.replace('## Besoin *','## Besoin'+body):ordinaryDescription.replace('Connaître les éléments manquants du ticket.',body);
  const read={status:'complete',available:true,complete:true,observedAt:'2026-11-06T21:00:00Z',source:'ticket-api-key',cached:false,
    scope:{key:'example',teamId:'team',projectId:null,includeArchived:false,linkedOutsideTeam:'identifier-state-only'},untrusted:true,
    data:{issue:{id:'one',identifier:'XJ-1',title:'Fixture',description,url:null,updatedAt:'2026-11-06T20:00:00Z',estimate:null,projectId:'epic',milestone:null,parent:null,untrusted:true,
      state:{id:'todo',name:'À faire',type:'unstarted'},classification:{source:'state-type',reason:null},
      labels:collection(readyLabels.map((name,i)=>({id:'label-'+i,name,untrusted:true}))),children:collection([]),
      dependencies:{blocks:collection([]),blockedBy:collection([])},complete:true}},partialReasons:[],
    limits:{pageSize:50,seedSize:3,maxPages:20,maxRequests:200,maxNodes:10000,budgetMs:23000,documentBytes:262144},usage:{requests:2,nodes:8,maxComplexity:null}};
  return {config,input:{key:'example',issueId:'one',read}};
}
