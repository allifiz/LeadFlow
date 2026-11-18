import {randomUUID} from 'node:crypto';
import {normalizeLead,mobileNumber} from './core.js';
const q=(c,sql,args=[])=>c.execute({sql,args});
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export const finderDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const str=(v,max)=>String(v??'').trim().slice(0,max);
const list=(v,max=20)=>Array.isArray(v)?[...new Set(v.map(x=>str(x,100)).filter(Boolean))].slice(0,max):[];
const choice=(v,allowed,fallback)=>allowed.includes(v)?v:fallback;
export const blankCampaign={name:'Website Garut',enabled:true,regions:['Kabupaten Garut, Jawa Barat'],districts:[],categories:[],excluded_categories:[],services:['Landing page','Company profile','Website sekolah'],daily_limit:20,website_status:'any',contact:'either',minimum_priority:50,sources:['Website publik','Media sosial bisnis','Direktori bisnis'],instruction:'Prioritaskan bisnis lokal dan calon pelanggan yang relevan.'};
export function validateCampaign(input,id=randomUUID()){
 if(!input||typeof input!=='object')throw Error('Campaign tidak valid');
 const name=str(input.name,100),regions=list(input.regions),services=list(input.services),daily_limit=Number(input.daily_limit),minimum_priority=Number(input.minimum_priority);
 if(!name||!regions.length||!services.length)throw Error('Nama, wilayah, dan jasa wajib diisi');
 if(!Number.isInteger(daily_limit)||daily_limit<1||daily_limit>20)throw Error('Target per campaign harus 1–20');
 if(!Number.isInteger(minimum_priority)||minimum_priority<0||minimum_priority>100)throw Error('Prioritas harus 0–100');
 const contact=choice(input.contact,['either','whatsapp','email','both'],'either');
 return {id,name,enabled:input.enabled===true,regions,districts:list(input.districts),categories:list(input.categories),excluded_categories:list(input.excluded_categories),services,daily_limit,website_status:choice(input.website_status,['any','no_website','needs_improvement','no_or_weak'],'any'),contact,minimum_priority,sources:list(input.sources),instruction:str(input.instruction,1000)};
}
export async function readConfig(c){
 const row=(await q(c,"SELECT value FROM settings WHERE key='finder_config'")).rows[0];
 return JSON.parse(row.value);
}
export async function finderConfig(c){
 const config=await readConfig(c),date=finderDay();
 const done=(await q(c,"SELECT campaign_id FROM finder_runs WHERE day=?",[date])).rows.map(x=>x.campaign_id);
 return {version:2,date,revision:config.revision,campaigns:config.campaigns.filter(x=>x.enabled&&!done.includes(x.id))};
}
export async function studio(c){
 const config=await readConfig(c);
 const history=(await q(c,"SELECT campaign_id,campaign_name,day,target,found,added,duplicates,invalid,created_at FROM finder_runs ORDER BY day DESC,created_at DESC LIMIT 50")).rows;
 return {...config,history};
}
export async function saveCampaign(c,body){
 const current=await readConfig(c);
 if(body.revision!==current.revision)return json({error:'Konfigurasi berubah. Segarkan Finder Studio dan coba lagi.'},409);
 let next;
 try{
  if(body.campaign?.id&&!current.campaigns.some(x=>x.id===body.campaign.id))return json({error:'Campaign tidak ditemukan'},404);
  const campaign=validateCampaign(body.campaign,body.campaign?.id||randomUUID());
  const campaigns=current.campaigns.filter(x=>x.id!==campaign.id).concat(campaign);
  if(campaigns.length>20||campaigns.filter(x=>x.enabled).reduce((sum,x)=>sum+x.daily_limit,0)>40)throw Error('Maksimal 20 campaign tersimpan dan total 40 target aktif per hari');
  next={revision:randomUUID(),campaigns};
 }catch(e){return json({error:e.message},400);}
 const saved=await q(c,"UPDATE settings SET value=? WHERE key='finder_config' AND value=?",[JSON.stringify(next),JSON.stringify(current)]);
 return saved.rowsAffected?json({ok:true,...next}):json({error:'Konfigurasi berubah. Segarkan Finder Studio.'},409);
}
export function qualifyLead(row,campaign){
 const l=normalizeLead(row);
 if(!l.source||l.priority<campaign.minimum_priority)throw Error('Sumber atau prioritas tidak memenuhi syarat');
 const mobile=mobileNumber(l.phone),email=!!l.email;
 if(campaign.contact==='whatsapp'&&!mobile||campaign.contact==='email'&&!email||campaign.contact==='both'&&(!mobile||!email)||campaign.contact==='either'&&!mobile&&!email)throw Error('Kontak tidak memenuhi syarat');
 return l;
}
export async function importCampaign(c,body){
 if(body.version!==2||typeof body.campaign_id!=='string'||typeof body.revision!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.date||'')||!Array.isArray(body.leads)||body.leads.length>20)return json({error:'Batch Finder V2 tidak valid'},400);
 const getRun=async()=> (await q(c,"SELECT target,found,added,duplicates,invalid FROM finder_runs WHERE campaign_id=? AND day=?",[body.campaign_id,body.date])).rows[0];
 const prior=await getRun();if(prior)return json({...prior,replayed:true});
 const config=await readConfig(c);
 const campaign=config.campaigns.find(x=>x.id===body.campaign_id&&x.enabled);
 if(!campaign||config.revision!==body.revision||body.date!==finderDay())return json({error:'Konfigurasi sudah berubah atau tanggal batch tidak berlaku'},409);
 if(body.leads.length>campaign.daily_limit)return json({error:'Batch melebihi target campaign'},400);
 const accepted=[];let invalid=0;
 for(const row of body.leads){try{accepted.push(qualifyLead(row,campaign));}catch{invalid++;}}
 const nonce=randomUUID();
 // A single atomic batch claims the day/campaign and counts actual inserts.
 const ops=[{sql:"INSERT OR IGNORE INTO finder_runs(campaign_id,campaign_name,day,revision,target,found,invalid,nonce) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT value FROM settings WHERE key='finder_config')=?",args:[campaign.id,campaign.name,body.date,config.revision,campaign.daily_limit,body.leads.length,invalid,nonce,JSON.stringify(config)]}];
 for(const l of accepted){
  ops.push({sql:"INSERT OR IGNORE INTO leads(name,name_key,phone,email,category,location,source,priority) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM finder_runs WHERE nonce=?)",args:[l.name,l.key,l.phone,l.email,l.category,l.location,l.source,l.priority,nonce]});
  ops.push({sql:"UPDATE finder_runs SET added=added+changes() WHERE nonce=?",args:[nonce]});
 }
 ops.push({sql:"UPDATE finder_runs SET duplicates=found-invalid-added WHERE nonce=?",args:[nonce]});
 await c.batch(ops,'write');
 const result=await getRun();
 return result?json(result):json({error:'Konfigurasi berubah sebelum import'},409);
}
