// Fakes for the environment check (M6): a fake PostgreSQL engine speaking the wire protocol on 127.0.0.1 (never a real
// base), and fake executables for docker, lsof and ps (never the real ones; no container is ever touched). Each fake
// writes what it was asked in a log of its folder, and its outputs may carry a canary that must appear nowhere.
import { createServer } from 'node:net';
import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const int32=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b;};
const message=(type,body=Buffer.alloc(0))=>Buffer.concat([Buffer.from(type),int32(body.length+4),body]);
const cstr=s=>Buffer.from(s+'\0');
const fields=(pairs)=>Buffer.concat([...Object.entries(pairs).map(([k,v])=>Buffer.concat([Buffer.from(k),cstr(v)])),Buffer.from([0])]);
const dataRow=row=>{const parts=[Buffer.from([row.length>>8,row.length&255])];for(const v of row){if(v===null)parts.push(int32(-1));else{const b=Buffer.from(String(v));parts.push(int32(b.length),b);}}return message('D',Buffer.concat(parts));};

// handler(sql,params,session) -> rows (array of arrays) | {error:{code,message}}
export async function fakePostgres({dir,auth:authOf='trust',handler=()=>[],canary=null}={}) {
  const startups=[],queries=[],sessions=new Set();
  const activity=()=>{if(dir)writeFileSync(join(dir,'activity.json'),JSON.stringify([...sessions].map(s=>s.application_name)));};
  const server=createServer(socket=>{
    let buffer=Buffer.alloc(0),started=false,session=null,pending=null;
    socket.on('error',()=>{});
    socket.on('close',()=>{if(session){sessions.delete(session);activity();}});
    socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      for(;;) {
        if(!started) {
          if(buffer.length<4)return;const len=buffer.readInt32BE(0);if(buffer.length<len)return;
          const body=buffer.subarray(4,len);buffer=buffer.subarray(len);
          const version=body.readInt32BE(0);
          if(version===80877103){socket.write('N');continue;}
          const parts=body.subarray(4).toString().split('\0');session={};
          for(let i=0;i+1<parts.length&&parts[i];i+=2)session[parts[i]]=parts[i+1];
          startups.push(session);started=true;
          const auth=typeof authOf==='function'?authOf():authOf;
          if(auth==='md5'){socket.write(message('R',Buffer.concat([int32(5),Buffer.from([1,2,3,4])])));return;}
          if(auth==='password'){socket.write(message('R',int32(3)));return;}
          if(auth==='scram'){socket.write(message('R',Buffer.concat([int32(10),cstr('SCRAM-SHA-256'),Buffer.from([0])])));return;}
          if(auth==='no-database'){socket.write(message('E',fields({S:'FATAL',C:'3D000',M:'database does not exist '+(canary??'')})));socket.end();return;}
          sessions.add(session);activity();
          socket.write(Buffer.concat([message('R',int32(0)),message('S',Buffer.concat([cstr('server_version'),cstr('17.0 '+(canary??''))])),message('K',Buffer.concat([int32(1),int32(2)])),
            ...(canary?[message('N',fields({S:'NOTICE',C:'00000',M:canary}))]:[]),message('Z',Buffer.from('I'))]));
          continue;
        }
        if(buffer.length<5)return;const type=String.fromCharCode(buffer[0]),len=buffer.readInt32BE(1);if(buffer.length<len+1)return;
        const body=buffer.subarray(5,len+1);buffer=buffer.subarray(len+1);
        if(type==='P'){const end=body.indexOf(0,0),sqlEnd=body.indexOf(0,end+1);pending={sql:body.subarray(end+1,sqlEnd).toString(),params:[]};}
        else if(type==='B'){let at=body.indexOf(0)+1;at=body.indexOf(0,at)+1;const nf=body.readInt16BE(at);at+=2+2*nf;const np=body.readInt16BE(at);at+=2;for(let i=0;i<np;i++){const l=body.readInt32BE(at);at+=4;pending.params.push(l<0?null:body.subarray(at,at+l).toString());if(l>0)at+=l;}}
        else if(type==='E'){/* execute */}
        else if(type==='S') {
          const q=pending;pending=null;queries.push({sql:q.sql,params:q.params,application_name:session.application_name});
          const out=handler(q.sql,q.params,session);
          if(out&&out.error)socket.write(Buffer.concat([message('1'),message('E',fields({S:'ERROR',C:out.error.code,M:out.error.message+' '+(canary??'')})),message('Z',Buffer.from('I'))]));
          else socket.write(Buffer.concat([message('1'),message('2'),...out.map(dataRow),message('C',cstr('SELECT '+out.length)),message('Z',Buffer.from('I'))]));
        }
        else if(type==='Q'){queries.push({sql:body.subarray(0,body.length-1).toString(),params:[],simple:true,application_name:session.application_name});socket.write(Buffer.concat([message('E',fields({S:'ERROR',C:'0A000',M:'simple query refused by the fake'})),message('Z',Buffer.from('I'))]));}
        else if(type==='X'){socket.end();return;}
      }
    });
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  if(dir)activity();
  return {port:server.address().port,startups,queries,sessions,close:()=>new Promise(r=>{server.close(()=>r());for(const s of sessions)void s;})};
}

// Fake executables, with an absolute shebang (the check runs docker under `env -i`: no PATH). Their behaviour is read from
// <dir>/scenario.json at each call; every call is logged in <dir>/calls.jsonl with its argv and the names of its
// environment (to prove what reached it).
export function fakeTools(dir,scenario) {
  mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'scenario.json'),JSON.stringify(scenario));
  const common=`const fs=require('fs'),path=require('path');const dir=${JSON.stringify(dir)};const s=JSON.parse(fs.readFileSync(path.join(dir,'scenario.json'),'utf8'));
const args=process.argv.slice(2);fs.appendFileSync(path.join(dir,'calls.jsonl'),JSON.stringify({tool:TOOL,args,env:Object.keys(process.env),dockerHost:process.env.DOCKER_HOST??null,dockerConfig:process.env.DOCKER_CONFIG??null})+'\\n');
if(s.canary)process.stderr.write('noise '+s.canary+'\\n');
const out=t=>{process.stdout.write(t);process.exit(0);};const die=(t,c=1)=>{process.stderr.write(t+' '+(s.canary??'')+'\\n');process.exit(c);};`;
  const docker=`const TOOL='docker';${common}
// A hostile engine answers whoever reaches it through DOCKER_HOST or a context: the check must never.
if(process.env.DOCKER_HOST||process.env.DOCKER_CONTEXT)out(JSON.stringify({hostile:true}));
if(args[0]!=='--host'||args[1]!=='unix://'+s.socket)die('wrong engine');
const [cmd,...rest]=args.slice(2);
const c=s.container;
if(s.dockerDown)die('Cannot connect to the Docker daemon');
// The identity of the engine: three fields of docker info, asked by a format (never the whole of docker info).
if(cmd==='info'){if(rest[0]!=='--format'||rest.length!==2)die('the check must ask a format');
  const g=s.engine??{ID:'ENGINE-LOCAL-0001',OperatingSystem:'Docker Desktop',Name:'docker-desktop'};
  out(JSON.stringify({id:g.ID,os:g.OperatingSystem,name:g.Name})+'\\n');}
if(cmd==='inspect'){if(!c||rest[rest.length-1]!==c.id&&rest[rest.length-1]!==c.name)die('Error: No such object');
  if(rest[0]!=='--format')die('the check must ask a format');
  out(JSON.stringify({id:c.id,image:c.image,running:c.running,ports:c.ports})+'\\n');}
if(cmd==='top'){if(!c||!c.running)die('not running');out('PID COMMAND\\n'+(s.top??['postgres','postgres']).map((n,i)=>(100+i)+' '+n).join('\\n')+'\\n');}
if(cmd==='exec'){
  if(!c||!c.running)die('not running');
  const i=rest.indexOf('/usr/bin/env');const inner=rest.slice(i+2);
  if(inner.includes('/usr/bin/head'))out(['1','/var/lib/postgresql/data','1700000000','5432','/var/run/postgresql',''].join('\\n'));
  const at=inner.indexOf('psql');if(at<0)die('unknown exec');
  // The local socket of the container not in trust: psql -w gives up, as the real one says it.
  if(s.socketAuth==='password')die('psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: fe_sendauth: no password supplied',2);
  if(s.socketAuth==='peer')die('psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: FATAL:  Peer authentication failed for user "app"',2);
  const sql=inner[inner.indexOf('-c')+1];
  const names=JSON.parse(fs.readFileSync(path.join(dir,'activity.json'),'utf8'));
  const m=/application_name = '([a-z0-9-]+)'/.exec(sql);
  if(!m)die('unknown query');
  out((s.correlation===false?0:names.filter(n=>n===m[1]).length)+'\\n');
}
die('unknown command');`;
  // lsof answers two questions: the listeners of a port, and (-p <pid> -d txt) the text files of a process, its real
  // executable first, then a library, as macOS lists them. `processes` holds the real executable of each pid.
  const lsof=`const TOOL='lsof';${common}
if(args.includes('-d')){const pid=args[args.indexOf('-p')+1];const p=(s.processes??{})[pid];if(!p)process.exit(1);
  out('p'+pid+'\\nftxt\\nn'+p+'\\nftxt\\nn/usr/lib/dyld\\n');}
const rows=s.listeners??[];if(!rows.length)process.exit(1);
out(rows.map(r=>'p'+r.pid+'\\nc'+r.command+'\\nn'+r.name).join('\\n')+'\\n');`;
  // ps -o comm= gives argv[0], which a process chooses (`exec -a`): `argv0` forges it, else the real executable.
  const ps=`const TOOL='ps';${common}
const pid=args[args.indexOf('-p')+1];const p=(s.argv0??{})[pid]??(s.processes??{})[pid];if(!p)process.exit(1);out(p+'\\n');`;
  const tools={};
  for(const [name,body] of [['docker',docker],['lsof',lsof],['ps',ps]]){const file=join(dir,name);writeFileSync(file,'#!'+process.execPath+'\n'+body);chmodSync(file,0o755);tools[name]=file;}
  return {...tools,calls:()=>{try{return readFileSync(join(dir,'calls.jsonl'),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));}catch{return [];}},set:next=>writeFileSync(join(dir,'scenario.json'),JSON.stringify(next)),log:line=>appendFileSync(join(dir,'calls.jsonl'),JSON.stringify(line)+'\n')};
}
