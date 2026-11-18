// Deliberately bounded presence analysis, not a general Markdown renderer.
const maxDescription=32768,maxLine=4096;
export function withinDescriptionLimits(description) {
  if(description.length>maxDescription)return false;
  let column=0;
  for(let i=0;i<description.length;i++) {if(description[i]==='\n'||description[i]==='\r')column=0;else if(++column>maxLine)return false;}
  return true;
}
const headings=new Map([
  ['besoin','need'],['résultat attendu','outcome'],["critères d'acceptation",'criteria'],['vérification','verification'],
  ['constat','observation'],['gravité','severity'],['reproduction','reproduction'],['cause','cause'],
]);
const whitespace=c=>c===' '||c==='\t';
function title(line) {
  let i=0;while(i<3&&line[i]===' ')i++;
  const start=i;while(line[i]==='#')i++;
  const level=i-start;if(level<1||level>6||i<line.length&&!whitespace(line[i]))return null;
  let value=line.slice(i).trim(),end=value.length;
  while(end>0&&value[end-1]==='#')end--;
  if(end<value.length&&(end===0||whitespace(value[end-1])))value=value.slice(0,end).trimEnd();
  return {level,value};
}
function removeComments(line,state) {
  const chunks=[];let i=0;
  while(i<line.length) {
    if(state.open){const end=line.indexOf('-->',i);if(end<0)break;state.open=false;i=end+3;}
    else {const start=line.indexOf('<!--',i);if(start<0){chunks.push(line.slice(i));break;}chunks.push(line.slice(i,start));state.open=true;i=start+4;}
  }
  return chunks.join('');
}
export function ticketSections(description) {
  const sections=new Map();if(!withinDescriptionLimits(description))return sections;
  const lines=description.split(/\r\n|[\r\n]/),comment={open:false};let current=null,fence=null;
  for(let index=0;index<lines.length;index++) {
    let line=lines[index];
    if(!fence)line=removeComments(line,comment);
    const marker=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if(fence) {
      if(marker&&marker[1][0]===fence.char&&marker[1].length>=fence.length&&!marker[2].trim()){fence=null;continue;}
      if(current){current.codeLines.add(current.length);current.push(line);}continue;
    }
    if(marker){fence={char:marker[1][0],length:marker[1].length};continue;}
    if(line.trim()&&/^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[index+1]??'')) {
      while(current?.length&&current.at(-1).trim()){current.codeLines.delete(current.length-1);current.pop();}
      current=null;index++;continue;
    }
    const heading=title(line);
    if(heading) {
      if(heading.level>2)continue;
      current=null;if(heading.level!==2)continue;
      let start=0,end=heading.value.length;
      while(start<end&&heading.value[start]==='*')start++;
      while(end>start&&heading.value[end-1]==='*')end--;
      const name=heading.value.slice(start,end).normalize('NFC').replaceAll('’',"'").toLowerCase().trim().replace(/\s+/g,' '),key=headings.get(name);
      if(key){current=[];Object.defineProperty(current,'codeLines',{value:new Set()});const list=sections.get(key)??[];list.push(current);sections.set(key,list);}
    }else if(current){if(/^(?: {4}|\t)/.test(line))current.codeLines.add(current.length);current.push(line);}
  }
  return sections;
}

function containerEnd(line) {
  let i=0;
  for(;;) {
    while(whitespace(line[i]))i++;
    if(line[i]==='>'){i++;continue;}
    let end=i;
    if(['-','*','+'].includes(line[end]))end++;
    else {while(end-i<9&&line[end]>='0'&&line[end]<='9')end++;if(end===i||!['.',')'].includes(line[end]))return i;end++;}
    if(end<line.length&&!whitespace(line[end]))return i;
    i=end;while(whitespace(line[i]))i++;
    if(line[i]==='['&&[' ','x','X'].includes(line[i+1])&&line[i+2]===']')i+=3;
  }
}
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
function decoded(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]*);/gi,(_,entity)=>{
    if(entity[0]!=='#')return entities[entity.toLowerCase()]??'';
    const point=entity[1]?.toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
    return point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):'';
  });
}
function destinationEnd(line,start) {
  let depth=1,quote=null,i=start+1;
  while(whitespace(line[i]))i++;
  let angle=line[i]==='<';if(angle)i++;
  while(i<line.length) {
    const c=line[i++];if(c==='\\'){if(i<line.length)i++;continue;}
    if(angle){if(c==='>')angle=false;continue;}
    if(quote){if(c===quote)quote=null;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='(')depth++;else if(c===')'&&--depth===0)break;
  }
  return i;
}
function escapedPunctuation(char) {
  const code=char?.charCodeAt(0);
  return code>=33&&code<=47||code>=58&&code<=64||code>=91&&code<=96||code>=123&&code<=126;
}
export function visibleText(raw) {
  const line=raw.replace(/\p{Default_Ignorable_Code_Point}/gu,'').replace(/\p{White_Space}/gu,' ');
  let i=containerEnd(line);if(title(line.slice(i)))return '';
  if(line[i]==='[') {
    const end=line.indexOf(']',i+1);
    if(end>=0&&line[end+1]===':') {if(line[i+1]!=='^')return '';i=end+2;}
  }
  const chunks=[];let plain=[];
  const flush=()=>{if(plain.length){chunks.push(decoded(plain.join('')));plain=[];}};
  while(i<line.length) {
    if(line[i]==='\\'&&escapedPunctuation(line[i+1])){plain.push(line[i+1]);i+=2;continue;}
    if(line[i]==='`') {
      const start=i;while(line[i]==='`')i++;const size=i-start,body=i;let end=i,closed=false;
      while(end<line.length) {
        if(line[end]!=='`'){end++;continue;}
        const run=end;while(line[end]==='`')end++;
        if(end-run===size){flush();chunks.push(line.slice(body,run));i=end;closed=true;break;}
      }
      if(!closed)break;continue;
    }
    if(line[i]==='['&&line[i+1]==='^') {const end=line.indexOf(']',i+2);i=end<0?line.length:end+1;continue;}
    if(line[i]==='['||line[i]==='!'&&line[i+1]==='['){i++;continue;}
    if(line[i]===']') {
      let next=i+1;while(whitespace(line[next]))next++;
      if(line[next]==='('){i=destinationEnd(line,next);continue;}
      if(line[next]==='['){const end=line.indexOf(']',next+1);i=end<0?line.length:end+1;continue;}
      i++;continue;
    }
    if(line[i]==='<'&&(/[a-z/!]/i).test(line[i+1]??'')) {
      const start=i++;let quote=null,closed=false;
      while(i<line.length) {
        const c=line[i++];if(quote){if(c===quote)quote=null;continue;}
        if(c==='"'||c==="'")quote=c;else if(c==='>'){closed=true;break;}
      }
      if(closed){const inner=line.slice(start+1,i-1);if(/^https?:\/\/[^\s<>]+$/.test(inner))plain.push(inner);}
      continue;
    }
    plain.push(line[i++]);
  }
  flush();return chunks.join('');
}
export function visibleCode(line) {
  return line.replace(/[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{C}\u2800]/gu,'').length>0;
}
