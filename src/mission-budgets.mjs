import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fail, readJSON, writeJSON, waitLock } from './common.mjs';
import { ofTicket } from './ticket-tokens.mjs';
import { budgetsFor, DEFAULT_BUDGETS } from './budget-config.mjs';
export { budgetsFor } from './budget-config.mjs';

// Provisional interface copy, kept together for the wording pass.
export const BUDGET_TEXT=Object.freeze({
  warning:who=>`${who}: token budget exceeded`,
  warningDetail:(who,n,b)=>`${who} has consumed an estimated ${n} tokens (budget: ${b}).`,
  checkFailed:'Token budget check unavailable',
  checkFailedDetail:'Budget enforcement could not be completed. The mission continues without a budget hold. Check the agent status before restarting it.',
});
// Budgets count only for the missions created from then on (decision of the user, 2026-11-17).
export const BUDGETS_SINCE='2026-11-17T18:30:00.000Z';
const tracked=mission=>Date.parse(mission?.createdAt)>=Date.parse(BUDGETS_SINCE);
const roles=Object.keys(DEFAULT_BUDGETS),counts=['in','out','input','cacheRead','cacheWrite'];
const group=role=>/^review-\d+$/.test(role)?'reviewer':roles.includes(role)?role:null;
const hash=s=>createHash('sha256').update(s).digest('hex');
const sum=(rows,key)=>rows.length&&rows.every(r=>Number.isSafeInteger(r[key])&&r[key]>=0)?rows.reduce((n,r)=>n+r[key],0):null;
const counterSum=(rows,key)=>{const n=sum(rows,key);return Number.isSafeInteger(n)?n:null;};
function totals(rows){
  const fields=Object.fromEntries(counts.map(k=>[k,counterSum(rows,k)]));
  return {...fields,total:fields.in===null||fields.out===null?null:fields.in+fields.out,partial:rows.some(r=>r.partial===true),unknown:rows.filter(r=>r.state!=='counted').length};
}
function unitsOf(launches,budgets){
  const units=new Map();
  for(const launch of launches){
    const {trace}=launch,role=group(trace.role);if(!role)continue;
    const unit=role==='dev'?trace.ticket:role==='reviewer'?trace.key:role;
    if(!unit)continue;
    const id=hash(role+'|'+unit);
    if(!units.has(id))units.set(id,{id,role,ticket:trace.ticket??null,budget:budgets[role],launches:[]});
    units.get(id).launches.push(launch);
  }
  return [...units.values()].map(u=>({...u,...totals(u.launches.map(l=>l.row))}));
}

// The watcher calls tick under the mission's lane lock. This module owns only its separate durable budget register;
// claimSay writes the journal and its idempotency mark together in the existing chain register.
export function createMissionBudgets({root,loadConfig,missions,usage,herdr,inbox,now=Date.now}) {
  const file=id=>join(root,'state','budgets-'+id+'.json');
  const valid=id=>{if(typeof id!=='string'||!/^[\w.-]{1,200}$/.test(id))fail('INVALID_ARGUMENT','mission is required.');return id;};
  async function state(id){
    const d=await readJSON(file(id),{version:1,units:{}});
    if(d?.version!==1||!d.units||typeof d.units!=='object'||Array.isArray(d.units))fail('INVALID_DATA','The mission budget register cannot be read.');
    return d;
  }
  async function reading(id){
    valid(id);const mission=await missions.read(id),config=await loadConfig();
    const data=await usage.inspect({mission:id});
    const allowances=budgetsFor(config,mission.project);
    return {mission,data,allowances,units:unitsOf(data?.launches??[],allowances)};
  }
  async function read({mission:id}={}){
    const {mission,data,units,allowances}=await reading(id),counted=tracked(mission);
    const budgets=roles.map(role=>{
      const own=units.filter(u=>u.role===role),rows=own.flatMap(u=>u.launches.map(l=>l.row)),t=totals(rows);
      return {role,consumed:t.total,budget:own.length?own.reduce((n,u)=>n+u.budget,0):allowances[role],
        state:!counted?'untracked':t.total===null?'unknown':own.some(u=>u.total!==null&&u.total>u.budget)?'exceeded':'ok',partial:t.partial};
    });
    // Even a mission with no traces exposes the four unknown roles, without manufacturing a zero.
    return {...(data?.tokens??{estimate:true,tickets:{},agents:[]}),budgets};
  }
  async function measure({mission:id}={}){
    valid(id);await missions.read(id);const data=await usage.inspect({mission:id}),launches=data?.launches??[];
    const tickets={};for(const l of launches)if(l.trace.ticket&&ofTicket(l.trace.role))(tickets[l.trace.ticket]??=[]).push(l.row);
    return {mission:id,estimate:true,total:totals(launches.map(l=>l.row)),roles:roles.map(role=>({role,...totals(launches.filter(l=>group(l.trace.role)===role).map(l=>l.row))})),
      tickets:Object.fromEntries(Object.entries(tickets).map(([ticket,rows])=>[ticket,totals(rows)]))};
  }
  // Simple first (decision of the user, 2026-11-17): a budget is counted and shown, and its crossing gives one alert and
  // one journal line. Nothing is stopped. A mission created before budgets came (BUDGETS_SINCE) is not counted.
  async function tick({mission,claimSay}){
    const id=valid(mission.id);
    if(!tracked(mission))return {hold:false,blocked:[]};
    return waitLock(join(root,'state','budget-lock-'+id),async()=>{
      const {units}=await reading(id),d=await state(id);
      for(const u of units){
        const mark=d.units[u.id]??={};
        if(u.total!==null&&u.total>u.budget&&!mark.warning){mark.warning={amount:u.total,budget:u.budget,at:new Date(now()).toISOString()};await writeJSON(file(id),d);}
        if(!mark.warning||mark.warning.said)continue;
        const who=u.role+(u.ticket?' · '+u.ticket:''),key='budget|'+u.id+'|warning';
        const title=BUDGET_TEXT.warning(who),text=BUDGET_TEXT.warningDetail(who,mark.warning.amount,mark.warning.budget);
        await inbox.ask({once:key,type:'stuck',cause:'budget-'+u.id+'-warning',mission:id,project:mission.project??null,issue:mission.issue?.identifier??null,ticket:u.ticket,question:null,title,text,blocked:[],proofs:[],since:mark.warning.at});
        await claimSay(id,key,title,'wait',text);
        mark.warning.said=true;await writeJSON(file(id),d);
      }
      return {hold:false,blocked:[]};
    });
  }
  return {read,measure,tick};
}

// A budget failure must never reach the watcher's pauseBlind path or interrupt QA, Validation or conversations.
// Journal idempotency lives in the chain register, independent of a possibly corrupt budget register.
export async function checkBudgets(check,context){
  let result;
  try{
    result=(await check?.(context))??{hold:false,blocked:[]};
  }
  catch{
    // Kept in the chain register, so a corrupt budget register or a new watcher cannot lose known exclusions.
    // A successful check rearms the journal; consecutive failures keep the same durable episode number.
    const saved=await context.updateBudgetCheck(s=>({...s,episode:s.unavailable?s.episode:(s.episode??0)+1,unavailable:true})).catch(()=>null);
    await context.claimSay(context.mission.id,'budget-check-unavailable|'+(saved?.episode??1),BUDGET_TEXT.checkFailed,'fail',BUDGET_TEXT.checkFailedDetail).catch(()=>{});
    return {hold:false,blocked:saved?.blocked??[]};
  }
  // Persistence is best-effort: it must never discard exclusions from a successful control.
  await context.updateBudgetCheck(s=>({...s,blocked:result.blocked??[],unavailable:false})).catch(()=>{});
  return result;
}
export const budgetBlocks=(result,role,ticket=null,terminal=null)=>(result?.blocked??[]).some(b=>b.role===role&&(role==='lead'||role==='qa'||b.ticket===ticket)&&(!terminal||b.terminals.includes(terminal)));
