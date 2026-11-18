import { object,text,fail } from './common.mjs';
import { qualifyTicket } from './ticket-qualification.mjs';

export function createTicketQualification({readConfig,readIssue}) {
  async function qualify(input) {
    object(input);
    if(Object.keys(input).some(key=>!['key','issueId'].includes(key)))fail('INVALID_ARGUMENT','Qualification accepts key and issueId only.');
    text(input.key,'project key',48);text(input.issueId,'issueId',200);
    const before=await readConfig(),{config}=before;
    if(config.version!==2)fail('CONFIG_V2_REQUIRED','Ticket qualification requires configuration version 2.');
    const project=config.projects.find(project=>project.key===input.key);
    if(!project)fail('NOT_FOUND','No configured project uses this key.');
    let read,failureReason;
    try {read=await readIssue({key:input.key,issueId:input.issueId,refresh:true});}
    catch(error){failureReason=error?.code==='TICKET_SCOPE'?'QUALIFICATION_SCOPE_UNVERIFIED':'QUALIFICATION_SOURCE_UNAVAILABLE';}
    read??={status:'unavailable',complete:false,cached:false,observedAt:new Date().toISOString(),partialReasons:[],data:{issue:null}};
    const after=await readConfig();
    return {...qualifyTicket(config,{...input,read,configStable:before.revision===after.revision,failureReason}),configRevision:before.revision};
  }
  return {qualify};
}
