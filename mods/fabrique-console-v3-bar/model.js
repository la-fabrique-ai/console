// Pure rules shared by the V3 screens. No Herdr import: tested with node --test.
const NEUTRAL='#9AA2AD';
const hex=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
export function projectLook(project) {
  return {color:hex(project?.color)?project.color:NEUTRAL};
}
const MIN=60000,HOUR=60*MIN,DAY=24*HOUR;
export function formatAge(at,now=Date.now()) {
  if(typeof at!=='number'||!Number.isFinite(at)) return '—';
  const age=Math.max(0,now-at);
  if(age<MIN) return '< 1 min';
  if(age<HOUR) return Math.floor(age/MIN)+' min';
  if(age<DAY) return Math.floor(age/HOUR)+' h';
  if(age<2*DAY) return 'hier';
  return Math.floor(age/DAY)+' j';
}
