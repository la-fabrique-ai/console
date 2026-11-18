import { ReadInterrupted } from './linear-enriched-transport.mjs';

export const unknownCollection=()=>({items:null,complete:false,total:null,cursor:null,reasons:[]});
export const READ_LIMITS=Object.freeze({pageSize:50,seedSize:3,maxPages:20,maxRequests:200,maxNodes:10000,budgetMs:23000,documentBytes:256*1024});
// Count remote entities by occurrence, including repeated state/team references.
// Connection wrappers and pageInfo are transport metadata, not entities.
function entityCount(value){
  if(!value||typeof value!=='object')return 0;
  return (typeof value.id==='string'?1:0)+Object.values(value).reduce((sum,item)=>sum+entityCount(item),0);
}
export class EnrichedPages {
  constructor(transport,limits={}){
    this.transport=transport;this.limits={...READ_LIMITS};
    for(const key of ['maxPages','maxNodes','maxRequests'])if(Number.isSafeInteger(limits[key])&&limits[key]>0)this.limits[key]=Math.min(limits[key],READ_LIMITS[key]);
    this.nodes=0;this.partialReasons=[];
    transport.observe=data=>{
      const cost=entityCount(data);
      if(this.nodes+cost>this.limits.maxNodes)throw new ReadInterrupted('node-limit');
      this.nodes+=cost;
    };
  }
  note(path,reason){
    if(!this.partialReasons.some(item=>item.path===path&&item.reason===reason))this.partialReasons.push({path,reason});
  }
  async collect({path,load,seed}){
    const result={items:[],complete:false,total:null,cursor:null,reasons:[]},seenIds=new Set(),seenCursors=new Set();let after=null,read=false;
    const interrupted=reason=>{result.reasons.push(reason);this.note(path,reason);};
    for(let page=0;page<this.limits.maxPages;page++){
      let connection;
      try{
        if(this.transport.controller.signal.aborted||this.transport.remaining()<=0)throw new ReadInterrupted('deadline');
        connection=page===0&&seed!==undefined?seed:await load(after);
      }catch(error){if(!(error instanceof ReadInterrupted))throw error;interrupted(error.reason);break;}
      if(!connection||!Array.isArray(connection.nodes)||typeof connection.pageInfo?.hasNextPage!=='boolean') {interrupted('invalid-connection');break;}
      read=true;
      for(const node of connection.nodes){
        if(!node||typeof node.id!=='string'){interrupted('invalid-node');break;}
        if(seenIds.has(node.id)){interrupted('duplicate-node');break;}
        seenIds.add(node.id);result.items.push(node);
      }
      if(result.reasons.length)break;
      if(!connection.pageInfo.hasNextPage){result.complete=true;result.total=result.items.length;result.cursor=null;break;}
      after=connection.pageInfo.endCursor;
      if(typeof after!=='string'||!after||seenCursors.has(after)){interrupted('invalid-cursor');break;}
      seenCursors.add(after);result.cursor=after;
      if(page===this.limits.maxPages-1)interrupted('page-limit');
    }
    if(!read)result.items=null;
    return result;
  }
  finish(collection,items){
    return {...collection,items,complete:collection.complete&&!(items??[]).some(item=>item.complete===false),total:collection.complete&&!(items??[]).some(item=>item.complete===false)?items?.length??null:null};
  }
}
