// Presentation only: never change recipient status or consent when filtering.
const formatDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'});
const formatTime=new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function parseUtc(value){
 if(!value)return null;
 const s=String(value).trim().replace(' ','T');
 const normalized=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(s)?s+'Z':s;
 const d=new Date(normalized);return Number.isNaN(+d)?null:d;
}
export function jakartaDay(value){const d=parseUtc(value);return d?formatDay.format(d):'';}
export function jakartaTime(value){const d=parseUtc(value);return d?formatTime.format(d):'—';}
export function customerView(l){
 if(l.status==='new'&&!l.blocked_at)return 'queue';
 if(['sending','unknown'].includes(l.status)&&!l.blocked_at)return 'review';
 return 'history';
}
export function historyEvent(l){
 if(l.status==='blocked'||l.blocked_at)return {at:l.blocked_at||l.updated_at||null,label:'Diblokir',channel:l.contact_channel||((l.attempt_state==='submitted'||l.attempt_state==='unknown')?'whatsapp':null)};
 if(l.contacted_at)return {at:l.contacted_at,label:l.status==='manual'?'Ditandai dihubungi':'Diajukan ke WhatsApp',channel:l.contact_channel||null};
 if(l.attempt_at)return {at:l.attempt_at,label:'Percobaan pengiriman',channel:'whatsapp'};
 return {at:null,label:l.status==='manual'?'Ditandai dihubungi':'Waktu tidak tercatat',channel:null};
}
export function eventFor(l,view){return view==='queue'?{at:l.created_at,label:'Masuk',channel:null}:historyEvent(l);}
export function selectCustomers(leads,{view='queue',period='all',today=formatDay.format(new Date()),date='',campaign='',channel='',status='',draft='',category='',search='',categoryOf=()=>''}={}){
 return leads.filter(l=>{
  if(customerView(l)!==view)return false;
  const e=eventFor(l,view),day=jakartaDay(e.at);
  return (!status||status===l.status)&&(!draft||draft===l.draft_state)&&(!category||categoryOf(l)===category)&&(!campaign||(campaign==='unknown'?!l.campaign_id:l.campaign_id===campaign))&&(!channel||(channel==='unknown'?!e.channel:e.channel===channel))&&(!date||day===date)&&(period==='all'||period==='today'&&day===today||period==='older'&&day!==today)&&[l.name,l.phone,l.email,l.category,l.location,l.campaign_name].join(' ').toLowerCase().includes(search.toLowerCase());
 }).sort((a,b)=>{
  const ea=eventFor(a,view),eb=eventFor(b,view);
  return (+parseUtc(eb.at)||0)-(+parseUtc(ea.at)||0)||Number(b.id)-Number(a.id);
 });
}
