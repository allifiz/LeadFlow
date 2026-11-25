import {randomUUID,createHash} from 'node:crypto';
import {normalizeLead,mobileNumber} from './core.js';
import {sourcePlan,summarizeSources} from '../public/finder-sources.js';
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
 const sources=list(input.sources),preferred_source=str(input.preferred_source,100);
 if(preferred_source&&!sourcePlan({sources}).includes(preferred_source))throw Error('Sumber prioritas harus termasuk sumber yang diizinkan');
 return {id,name,enabled:input.enabled===true,regions,districts:list(input.districts),categories:list(input.categories),excluded_categories:list(input.excluded_categories),services,daily_limit,website_status:choice(input.website_status,['any','no_website','needs_improvement','no_or_weak'],'any'),contact,minimum_priority,sources,preferred_source,instruction:str(input.instruction,1000)};
}
export async function readConfig(c){
 const row=(await q(c,"SELECT value FROM settings WHERE key='finder_config'")).rows[0];
 return JSON.parse(row.value);
}
export const batchSize=config=>config.batch_size===5?5:10;
export async function finderConfig(c,batchMode=false,transportMax=5){
 const config=await readConfig(c),date=finderDay();
 const runs=(await q(c,"SELECT campaign_id,added FROM finder_runs WHERE day=?",[date])).rows;
 const progress=new Map(runs.map(x=>[x.campaign_id,Number(x.added)]));
 const campaigns=config.campaigns.filter(x=>x.enabled).flatMap(x=>{
   const added=progress.get(x.id)||0;
   if(!batchMode)return progress.has(x.id)?[]:[x];
   const remaining=Math.max(0,x.daily_limit-added);
   return remaining?[{...x,added_today:added,remaining}]:[];
 });
 return {version:2,date,revision:config.revision,...(batchMode?{batch_protocol:3,batch_size:Math.min(batchSize(config),transportMax===10?10:5)}:{}),campaigns:campaigns.map(x=>{const source_priority=sourcePlan(x);return {...x,source_priority,instruction:[x.instruction,'Riset V5: prioritaskan sumber yang diizinkan sesuai urutan: '+source_priority.join(', ')+'. Gunakan beberapa sumber publik jika tersedia; jika hasil rendah atau duplikat, pindah sumber. Verifikasi identitas dan kontak bisnis publik, cek duplikat lintas sumber, jangan mengarang data atau menyimpulkan tidak punya website dari hasil kosong.'].filter(Boolean).join(' ')};})};
}
export async function studio(c){
 const config=await readConfig(c);
 const history=(await q(c,"SELECT r.campaign_id,r.campaign_name,r.day,r.target,r.found,r.added,r.duplicates,r.invalid,r.created_at,(SELECT COUNT(*) FROM finder_batches b WHERE b.campaign_id=r.campaign_id AND b.day=r.day) AS batches FROM finder_runs r ORDER BY r.day DESC,r.created_at DESC LIMIT 50")).rows;
 const today=finderDay();
 const progress=(await q(c,"SELECT r.campaign_id,r.added,r.found,r.duplicates,r.invalid,(SELECT COUNT(*) FROM finder_batches b WHERE b.campaign_id=r.campaign_id AND b.day=r.day) AS batches FROM finder_runs r WHERE r.day=?",[today])).rows;
 const sourceRows=(await q(c,"SELECT campaign_id,source,COUNT(*) AS added FROM leads WHERE campaign_id IS NOT NULL GROUP BY campaign_id,source")).rows;
 return {...config,batch_size:batchSize(config),history,today,progress,source_stats:summarizeSources(sourceRows)};
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
  next={...current,revision:randomUUID(),campaigns};
 }catch(e){return json({error:e.message},400);}
 const saved=await q(c,"UPDATE settings SET value=? WHERE key='finder_config' AND value=?",[JSON.stringify(next),JSON.stringify(current)]);
 return saved.rowsAffected?json({ok:true,...next}):json({error:'Konfigurasi berubah. Segarkan Finder Studio.'},409);
}
export async function saveBatchSize(c,body){
 const current=await readConfig(c);
 if(body.revision!==current.revision)return json({error:'Konfigurasi berubah. Segarkan Finder Studio.'},409);
 if(![5,10].includes(body.batch_size))return json({error:'Ukuran batch harus 5 atau 10'},400);
 if(batchSize(current)===body.batch_size)return json({ok:true,revision:current.revision,batch_size:body.batch_size});
 const next={...current,revision:randomUUID(),batch_size:body.batch_size};
 const saved=await q(c,"UPDATE settings SET value=? WHERE key='finder_config' AND value=?",[JSON.stringify(next),JSON.stringify(current)]);
 return saved.rowsAffected?json({ok:true,revision:next.revision,batch_size:next.batch_size}):json({error:'Konfigurasi berubah. Segarkan Finder Studio.'},409);
}
export function qualifyLead(row,campaign){
 const l=normalizeLead(row);
 if(!l.source||l.priority<campaign.minimum_priority)throw Error('Sumber atau prioritas tidak memenuhi syarat');
 const mobile=mobileNumber(l.phone),email=!!l.email;
 if(campaign.contact==='whatsapp'&&!mobile||campaign.contact==='email'&&!email||campaign.contact==='both'&&(!mobile||!email)||campaign.contact==='either'&&!mobile&&!email)throw Error('Kontak tidak memenuhi syarat');
 return l;
}
export async function importCampaign(c,body){
 if(body.version===3)return importBatch(c,body);
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
  ops.push({sql:"INSERT OR IGNORE INTO leads(name,name_key,phone,email,category,location,source,priority,campaign_id,campaign_name) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM finder_runs WHERE nonce=?)",args:[l.name,l.key,l.phone,l.email,l.category,l.location,l.source,l.priority,campaign.id,campaign.name,nonce]});
  ops.push({sql:"UPDATE finder_runs SET added=added+changes() WHERE nonce=?",args:[nonce]});
 }
 ops.push({sql:"UPDATE finder_runs SET duplicates=found-invalid-added WHERE nonce=?",args:[nonce]});
 await c.batch(ops,'write');
 const result=await getRun();
 return result?json(result):json({error:'Konfigurasi berubah sebelum import'},409);
}

export async function importBatch(c,body){
 const {batch_id,campaign_id,revision,date,leads}=body;
 if(body.version!==3||typeof batch_id!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(batch_id)||typeof campaign_id!=='string'||typeof revision!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Array.isArray(leads)||leads.length>10)return json({error:'Batch Finder V3 tidak valid'},400);
 const hash=createHash('sha256').update(JSON.stringify({campaign_id,revision,date,leads})).digest('hex');
 const readBatch=async()=> (await q(c,"SELECT campaign_id,day,revision,payload_hash,found,added,duplicates,invalid FROM finder_batches WHERE batch_id=?",[batch_id])).rows[0];
 const reply=(r,replayed=false)=>r.payload_hash!==hash?json({error:'Batch ID sudah digunakan untuk payload berbeda'},409):json({batch_id,found:r.found,added:r.added,duplicates:r.duplicates,invalid:r.invalid,replayed});
 const existing=await readBatch();if(existing)return reply(existing,true);
 const config=await readConfig(c),campaign=config.campaigns.find(x=>x.id===campaign_id&&x.enabled);
 if(!campaign||config.revision!==revision||date!==finderDay())return json({error:'Konfigurasi berubah atau tanggal batch tidak berlaku'},409);
 if(leads.length>batchSize(config))return json({error:'Batch melebihi ukuran yang dikonfigurasi'},400);
 const accepted=[];let invalid=0;
 for(const row of leads){try{accepted.push(qualifyLead(row,campaign));}catch{invalid++;}}
 const nonce=randomUUID();
 // One atomic write transaction: claim id, enforce remaining capacity, insert leads and update daily totals.
 // Check the remaining quota inside the transaction, not only in the prior read.
 const ops=[{sql:"INSERT OR IGNORE INTO finder_batches(batch_id,campaign_id,day,revision,payload_hash,found,invalid,nonce) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT value FROM settings WHERE key='finder_config')=? AND COALESCE((SELECT added FROM finder_runs WHERE campaign_id=? AND day=?),0)<? AND COALESCE((SELECT added FROM finder_runs WHERE campaign_id=? AND day=?),0)+?<=?",args:[batch_id,campaign_id,date,revision,hash,leads.length,invalid,nonce,JSON.stringify(config),campaign_id,date,campaign.daily_limit,campaign_id,date,leads.length,campaign.daily_limit]}];
 ops.push({sql:"INSERT OR IGNORE INTO finder_runs(campaign_id,campaign_name,day,revision,target,found,nonce) SELECT ?,?,?,?,?,0,? WHERE EXISTS(SELECT 1 FROM finder_batches WHERE nonce=?)",args:[campaign_id,campaign.name,date,revision,campaign.daily_limit,nonce,nonce]});
 for(const l of accepted){
   ops.push({sql:"INSERT OR IGNORE INTO leads(name,name_key,phone,email,category,location,source,priority,campaign_id,campaign_name,batch_id) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM finder_batches WHERE nonce=?)",args:[l.name,l.key,l.phone,l.email,l.category,l.location,l.source,l.priority,campaign.id,campaign.name,batch_id,nonce]});
   ops.push({sql:"UPDATE finder_batches SET added=added+changes() WHERE nonce=?",args:[nonce]});
 }
 ops.push({sql:"UPDATE finder_batches SET duplicates=found-invalid-added WHERE nonce=?",args:[nonce]});
 ops.push({sql:"UPDATE finder_runs SET campaign_name=?,revision=?,target=?,found=found+(SELECT found FROM finder_batches WHERE nonce=?),added=added+(SELECT added FROM finder_batches WHERE nonce=?),duplicates=duplicates+(SELECT duplicates FROM finder_batches WHERE nonce=?),invalid=invalid+(SELECT invalid FROM finder_batches WHERE nonce=?) WHERE campaign_id=? AND day=? AND EXISTS(SELECT 1 FROM finder_batches WHERE nonce=?)",args:[campaign.name,revision,campaign.daily_limit,nonce,nonce,nonce,nonce,campaign_id,date,nonce]});
 await c.batch(ops,'write');
 const saved=await readBatch();
 return saved?reply(saved):json({error:'Target tersisa tidak cukup, campaign selesai, atau konfigurasi berubah. Ambil konfigurasi terbaru.'},409);
}
