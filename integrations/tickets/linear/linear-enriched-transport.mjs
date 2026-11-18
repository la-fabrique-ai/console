import { performance } from 'node:perf_hooks';
import { fail } from '../../../src/common.mjs';
import { READ_QUERIES } from './linear-enriched-queries.mjs';
import { assertNoCredential } from './linear-enriched-cache.mjs';

export class ReadInterrupted extends Error {
  constructor(reason){super('La lecture Linear est incomplète.');this.reason=reason;}
}
export class EnrichedReadTransport {
  constructor({token,fetch=globalThis.fetch,now=()=>performance.now(),wallNow=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),budgetMs=23000,maxRequests=200,maxBodyBytes=2*1024*1024}={}){
    Object.assign(this,{token,fetch,now,wallNow,sleep});
    this.budgetMs=Math.min(budgetMs,23000);this.deadline=now()+this.budgetMs;
    this.maxRequests=Math.min(maxRequests,200);this.maxBodyBytes=Math.min(maxBodyBytes,2*1024*1024);
    this.requests=0;this.maxComplexity=null;this.controller=new AbortController();
    this.timer=setTimeout(()=>this.controller.abort(),this.budgetMs);
  }
  close(){clearTimeout(this.timer);this.controller.abort();}
  remaining(){return Math.max(0,this.deadline-this.now());}
  async bounded(task,signal=this.controller.signal){
    if(signal.aborted||this.remaining()<=0)throw new ReadInterrupted('deadline');
    let rejectAbort;
    const aborted=new Promise((_,reject)=>{rejectAbort=()=>reject(new ReadInterrupted(this.remaining()<=0||this.controller.signal.aborted?'deadline':'request-timeout'));signal.addEventListener('abort',rejectAbort,{once:true});});
    try{return await Promise.race([Promise.resolve().then(task),aborted]);}
    finally{signal.removeEventListener('abort',rejectAbort);}
  }
  retryDelay(headers,attempt){
    const retry=headers.get('retry-after');
    if(retry!==null){const seconds=Number(retry),delay=Number.isFinite(seconds)?seconds*1000:Date.parse(retry)-this.wallNow();return Number.isFinite(delay)?Math.max(0,delay):1000;}
    let delay=1000*2**attempt;
    for(const category of ['requests','endpoint-requests','complexity']){
      if(headers.get('x-ratelimit-'+category+'-remaining')!=='0')continue;
      const reset=Number(headers.get('x-ratelimit-'+category+'-reset'));
      if(Number.isFinite(reset))delay=Math.max(delay,reset-this.wallNow());
    }
    return delay;
  }
  async body(response,signal){
    const reader=response.body?.getReader();if(!reader)throw new ReadInterrupted('api-error');
    let size=0;const chunks=[];
    try{
      for(;;){const {done,value}=await this.bounded(()=>reader.read(),signal);if(done)break;size+=value.byteLength;if(size>this.maxBodyBytes)throw new ReadInterrupted('response-too-large');chunks.push(value);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ReadInterrupted('api-error');}
      assertNoCredential(body,this.token);
      return body;
    }finally{void reader.cancel().catch(()=>{});}
  }
  async request(operation,variables){
    if(!Object.hasOwn(READ_QUERIES,operation))fail('INVALID_ARGUMENT','Unsupported enriched Linear read operation.');
    for(let attempt=0;attempt<3;attempt++){
      if(this.controller.signal.aborted||this.remaining()<=0)throw new ReadInterrupted('deadline');
      if(this.requests>=this.maxRequests)throw new ReadInterrupted('request-limit');
      this.requests++;
      const requestController=new AbortController(),remaining=this.remaining();
      const timer=setTimeout(()=>remaining<=8000?this.controller.abort():requestController.abort(),Math.min(8000,remaining));
      const signal=AbortSignal.any([this.controller.signal,requestController.signal]);
      let response,body;
      try{
        response=await this.bounded(()=>this.fetch('https://api.linear.app/graphql',{method:'POST',headers:{'Content-Type':'application/json',Authorization:this.token},body:JSON.stringify({query:READ_QUERIES[operation],variables}),signal}),signal);
        if(response.status===401||response.status===403)fail('LINEAR_AUTH','Linear a refusé les identifiants ou les droits de lecture.');
        try{body=await this.body(response,signal);}
        catch(error){if(response.status===429&&error instanceof ReadInterrupted&&error.reason==='api-error')body={};else throw error;}
      }catch(error){
        if(error instanceof ReadInterrupted||error?.code==='LINEAR_SECRET_RESPONSE'||error?.code==='LINEAR_AUTH')throw error;
        throw new ReadInterrupted(signal.aborted?(this.controller.signal.aborted||this.remaining()<=0?'deadline':'request-timeout'):'unavailable');
      }finally{clearTimeout(timer);requestController.abort();}
      const complexity=Number(response.headers.get('x-complexity'));
      if(response.headers.has('x-complexity')&&Number.isFinite(complexity))this.maxComplexity=Math.max(this.maxComplexity??0,complexity);
      const errors=Array.isArray(body?.errors)?body.errors:[];
      const limited=response.status===429||errors.some(error=>/rate.?limit/i.test(String(error.extensions?.code??'')));
      const tooComplex=errors.some(error=>/complexity/i.test(String(error.extensions?.code??''))||(/complexity/i.test(String(error.message??''))&&/limit|exceed|high/i.test(String(error.message??''))));
      if(tooComplex)throw new ReadInterrupted('complexity-limit');
      if(limited){
        const delay=this.retryDelay(response.headers,attempt);
        if(attempt===2||delay>=this.remaining())throw new ReadInterrupted('rate-limit');
        await this.bounded(()=>this.sleep(delay));continue;
      }
      if(!response.ok||errors.length||!body?.data||typeof body.data!=='object')throw new ReadInterrupted('api-error');
      this.observe?.(body.data);
      return body.data;
    }
  }
}
