import {View,div,image} from 'gpui-kit';
import {InputState,Input} from 'gpui-base';
import {shared,setShared,run,exec} from 'herdr';
import {snapshot,api} from './kit.js';
import {v_flex,h_flex,C,screen,h1,hd,dim,pill,btn,empty,fault,projectTile,alertToast} from './look.js';
import {W} from './words.js';
import {KEYS,SCREENS,machineToShow,mockupShown,mockupPick} from './nav.js';
// A mockup where the user decides: the picture of each variant, the one he chooses, and a note for the Lead.
const MOD='fabrique-console-v4-mockup',MARGINS=64;
export default class Mockup extends View {
 init() {this.at=0;this.of=null;this.shown=null;this.size=null;this.busy=false;this.error='';this.note=InputState.new({value:'',placeholder:W.mockup.note});}
 // Back to the ticket it was published for, on the page of its development.
 back(wanted,mission,mockup) {
  if(!mission){run('layout.switch',{name:wanted?.back||SCREENS.inbox});return;}
  setShared(KEYS.machine,machineToShow(mission,shared(KEYS.machine)));setShared(KEYS.mission,mission.id);setShared(KEYS.project,null);setShared(KEYS.ticket,mockup?.ticket||null);
  run('layout.switch',{name:SCREENS.devs});
 }
 // `shown` is what was drawn when the button was: the publication, the request it is for and the version of that
 // request (nav.js, mockupShown). They go together, as they were drawn: nothing is read again when the button is
 // clicked, so a publication or a request that changed since is refused by the engine, never answered unseen.
 choose(shown,variant,cx) {
  if(this.busy)return;
  this.busy=true;this.error='';cx.notify();
  const note=this.note.value().trim();
  cx.spawn(async cx=>{
   try{await api(MOD,'mockup-pick',mockupPick(shown,shown.mission,variant.name,note));this.note.set_value('');}
   catch(e){alertToast(e.message||e);}
   finally{this.busy=false;cx.notify();}
  });
 }
 render() {
  const wanted=shared(KEYS.mockup),mission=(shared(KEYS.missions)||[]).find(m=>m.id===wanted?.mission)||null,mockup=(mission?.mockups||[]).find(k=>k.id===wanted?.id)||null;
  if(this.of!==wanted?.id){this.of=wanted?.id;this.at=0;}
  const root=screen().id('mockup').on_size_change((size,cx)=>{this.size=size;cx.notify();}),back=btn('mockup-back','‹',()=>this.back(wanted,mission,mockup),{tone:'plain'});
  if(!mockup)return root.child(hd(h1(W.mockup.title),back)).child(empty(W.mockup.none));
  this.shown=mockupShown(this.shown,mockup,shared(KEYS.inbox)||[]);
  const shown={...this.shown,mission:mission.id};
  const variant=mockup.variants[Math.min(this.at,mockup.variants.length-1)],width=Math.max(320,(this.size?.width||1100)-MARGINS),height=Math.round(width*variant.height/variant.width),project=(snapshot().projects||[]).find(p=>p.key===mission.project)||null,facts=[mission.issue?.identifier,mockup.ticket].filter(Boolean).join(' · ');
  return root
   .child(hd(h_flex().flex_1().min_w(0).items_center().gap(12).child(projectTile(project,40,22)).child(v_flex().min_w(0).child(h1(mockup.title)).child(dim(facts))),
    h_flex().flex_none().gap(6).child(back).child(btn('mockup-browser',W.mockup.browser,(_e,cx)=>{const page=mockup.folder+'/'+variant.file;cx.spawn(async()=>{await exec('open',[page]);});},{tone:'plain'}))))
   .when(Boolean(this.error),e=>e.child(fault(this.error)))
   .when(mockup.variants.length>1,e=>e.child(h_flex().flex_none().gap(6).children(mockup.variants.map((v,n)=>btn('variant-'+n,v.name.toUpperCase(),(_e,cx)=>{this.at=n;cx.notify();},{tone:n===this.at?'mockup':'plain'})))))
   .child(v_flex().id('mockup-scroll').flex_1().min_h(0).overflow_y_scrollbar().child(div().flex_none().child(image(variant.image).w(width).h(height))))
   .child(h_flex().flex_none().items_center().gap(8)
    .when(Boolean(mockup.picked),e=>e.child(pill('ok',W.mockup.chosen(mockup.picked.variant.toUpperCase()))))
    .child(Input.new(this.note).flex_1().h(30).px(8).rounded(8).bg(C.bg).border_1().border_color(C.strong).text_size(13).text_color(C.txt))
    .child(btn('mockup-pick',this.busy?W.mockup.choosing:mockup.variants.length>1?W.mockup.choose(variant.name.toUpperCase()):W.mockup.approve,(_e,cx)=>this.choose(shown,variant,cx),{tone:'ok'})));
 }
}
