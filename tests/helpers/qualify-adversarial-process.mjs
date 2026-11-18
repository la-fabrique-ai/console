import { qualifyTicket } from '../../src/ticket-qualification.mjs';
import { qualificationInput } from './qualification-input.mjs';
const kind=process.argv[2],size=Number(process.argv[3]);
const bodies={link:()=> '[a]('+'\\'.repeat(size),html:()=>'<a'.repeat(size),brackets:()=> '['.repeat(size),heading:()=> ' '.repeat(size)+'x\0',
  line:()=> 'a'.repeat(size),total:()=> 'a\n'.repeat(size),nested:()=> '>'.repeat(size)+' ',backticks:()=> '`'.repeat(size)+'x'};
const {config,input}=qualificationInput(bodies[kind](),{heading:kind==='heading'}),started=performance.now();
const result=qualifyTicket(config,input);
process.stdout.write(JSON.stringify({elapsed:performance.now()-started,ok:result.ready.ok,check:result.ready.checks.find(check=>check.rule===4)})+'\n');
