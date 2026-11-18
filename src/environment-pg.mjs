// The PostgreSQL connection of the environment check (M6): Node built-ins only, the extended protocol, text values.
//
// What it guarantees: a TCP connection to 127.0.0.1 only (never a name, so no resolver); the session in
// default_transaction_read_only=on from its start (startup option); a given application_name (the check proves by it,
// from inside the container, that this very connection reached it); the trust method only (decision 93, point 2): any
// request of a password ends the connection, nothing is sent and no secret is read; parameters sent apart from the
// text of the query. An error is a word (`pg`) and an SQLSTATE, never the text of the server: nothing it says is kept.
import { connect } from 'node:net';

const int32=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b;};
const int16=n=>{const b=Buffer.alloc(2);b.writeInt16BE(n);return b;};
const cstr=s=>Buffer.from(s+'\0','utf8');
const frame=(type,body)=>Buffer.concat([Buffer.from(type),int32(body.length+4),body]);
const failure=(pg,sqlstate=null)=>Object.assign(new Error('PostgreSQL: '+pg+(sqlstate?' ('+sqlstate+')':'')),{pg,sqlstate});
// The SQLSTATE of an ErrorResponse, its only field kept.
const stateOf=body=>{for(let at=0;at<body.length&&body[at]!==0;){const kind=String.fromCharCode(body[at]),end=body.indexOf(0,at+1);if(kind==='C'){const v=body.subarray(at+1,end).toString();return /^[0-9A-Z]{5}$/.test(v)?v:null;}at=end+1;}return null;};

export function pgConnect({host='127.0.0.1',port,user,database,applicationName,timeoutMs=8000}) {
  return new Promise((resolve,reject)=>{
    if(host!=='127.0.0.1'){reject(failure('host'));return;}
    if(!Number.isInteger(port)||port<1||port>65535||!/^[a-z0-9_-]{1,64}$/.test(applicationName??'')){reject(failure('argument'));return;}
    const socket=connect({host,port});
    let buffer=Buffer.alloc(0),ready=false,waiting=null,settled=false,rows=[],error=null;
    const timer=setTimeout(()=>{abort(failure('timeout'));},timeoutMs);
    const abort=reason=>{
      clearTimeout(timer);try{socket.destroy();}catch{}
      if(!ready&&!settled){settled=true;reject(reason);}
      // The query waiting fails now, and its own timer goes with it: nothing keeps the process alive after a cut.
      if(waiting){const w=waiting;waiting=null;clearTimeout(w.timer);w.reject(reason);}
    };
    socket.on('error',e=>abort(failure(['ECONNREFUSED','ECONNRESET','EHOSTUNREACH','ENETUNREACH'].includes(e.code)?'refused':'network')));
    socket.on('close',()=>abort(failure('closed')));
    socket.on('connect',()=>{
      const body=Buffer.concat([int32(196608),cstr('user'),cstr(user),cstr('database'),cstr(database),cstr('application_name'),cstr(applicationName),cstr('options'),cstr('-c default_transaction_read_only=on'),Buffer.from([0])]);
      socket.write(Buffer.concat([int32(body.length+4),body]));
    });
    socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      while(buffer.length>=5) {
        const type=String.fromCharCode(buffer[0]),len=buffer.readInt32BE(1);
        if(len<4||len>16*1024*1024){abort(failure('protocol'));return;}
        if(buffer.length<len+1)return;
        const body=buffer.subarray(5,len+1);buffer=buffer.subarray(len+1);
        if(type==='R') {
          // 0: trusted. Anything else asks a password or a key: never answered.
          if(body.readInt32BE(0)!==0){abort(failure('auth'));return;}
        }else if(type==='E') {
          error=failure('sql',stateOf(body));
          if(!ready){abort(error);return;}
        }else if(type==='D') {
          const n=body.readInt16BE(0),row=[];let at=2;
          for(let i=0;i<n;i++){const l=body.readInt32BE(at);at+=4;if(l<0)row.push(null);else{row.push(body.subarray(at,at+l).toString('utf8'));at+=l;}}
          rows.push(row);
        }else if(type==='Z') {
          if(!ready){ready=true;clearTimeout(timer);settled=true;resolve(api);continue;}
          const w=waiting;waiting=null;clearTimeout(w?.timer);
          const out=rows,failed=error;rows=[];error=null;
          if(w){if(failed)w.reject(failed);else w.resolve(out);}
        }
        // S (parameters), K (key), N (notices), 1, 2, C, n, T: nothing of them is kept.
      }
    });
    const api={
      query(sql,params=[]) {
        if(waiting)return Promise.reject(failure('busy'));
        if(socket.destroyed)return Promise.reject(failure('closed'));
        return new Promise((ok,ko)=>{
          waiting={resolve:ok,reject:ko,timer:setTimeout(()=>abort(failure('timeout')),timeoutMs)};
          const values=params.map(v=>v===null?int32(-1):Buffer.concat([int32(Buffer.byteLength(String(v))),Buffer.from(String(v))]));
          socket.write(Buffer.concat([
            frame('P',Buffer.concat([cstr(''),cstr(sql),int16(0)])),
            frame('B',Buffer.concat([cstr(''),cstr(''),int16(0),int16(params.length),...values,int16(0)])),
            frame('E',Buffer.concat([cstr(''),int32(0)])),
            frame('S',Buffer.alloc(0)),
          ]));
        });
      },
      close() {
        return new Promise(done=>{
          if(socket.destroyed){done();return;}
          socket.once('close',()=>done());
          try{socket.end(frame('X',Buffer.alloc(0)));}catch{done();}
          setTimeout(()=>{try{socket.destroy();}catch{}done();},1000).unref();
        });
      },
      get open(){return !socket.destroyed;},
    };
  });
}
