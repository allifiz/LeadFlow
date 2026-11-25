import {randomUUID} from 'node:crypto';
import {BRAND_NAME,BRAND_WEBSITE,SENDER_NAME} from './core.js';
const q=(c,sql,args=[])=>c.execute({sql,args});
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const bad=(error,status=400)=>json({error},status);
const str=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
const docId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{15,150}$/.test(v);
const safeUrl=v=>{if(!v)return '';try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
export const proposalSchema={sql:"CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES proposals(id), lead_id INTEGER REFERENCES leads(id), customer TEXT NOT NULL, input_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','published','completed','approved','failed')), result_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"};
const bridgeConfigured=()=>!!process.env.PROPOSAL_BRIDGE_URL&&String(process.env.PROPOSAL_WEBHOOK_SECRET||'').length>=32;
async function notifyBridge(id){
 if(!bridgeConfigured())return false;
 try{
  const u=new URL(process.env.PROPOSAL_BRIDGE_URL);
  if(u.origin!=='https://script.google.com'||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname)||u.search||u.hash)return false;
  const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:process.env.PROPOSAL_WEBHOOK_SECRET,request_id:id}),signal:AbortSignal.timeout(12000),redirect:'manual'});
  if(r.status===302||r.status===303){
   const target=new URL(r.headers.get('location')||'');
   if(target.origin!=='https://script.googleusercontent.com')return false;
   const result=await fetch(target,{signal:AbortSignal.timeout(8000),redirect:'error'});
   return result.ok&&(await result.json()).ok===true;
  }
  return r.ok&&(await r.json()).ok===true;
 }catch{return false;}
}
export const proposalActions=['proposal-list','proposal-create','proposal-revise','proposal-approve','proposal-pending','proposal-published','proposal-result','proposal-dispatch'];
export const proposalBridgeActions=['proposal-pending','proposal-published','proposal-result'];
export function normalizeProposal(body){
 if(!body||typeof body!=='object')return null;
 const customer=str(body.customer,160),project=str(body.project,160),budget=Number(body.budget),duration=Number(body.duration);
 if(!customer||!project||body.budget===''||body.budget==null||!Number.isSafeInteger(budget)||budget<0||budget>100000000000||!Number.isSafeInteger(duration)||duration<1||duration>730)return null;
 const website=safeUrl(str(body.website,1000)),preview=safeUrl(str(body.preview,1000));
 if((body.website&&!website)||(body.preview&&!preview))return null;
 return {customer,project,budget,duration,website,preview,background:str(body.background,3000),features:str(body.features,4000),payment:str(body.payment,500),style:str(body.style,200)||'Premium corporate',notes:str(body.notes,3000),research:body.research===true};
}
export function normalizeResult(body){
 if(body?.state==='failed')return {error:str(body.error,500)||'GPT tidak dapat menyelesaikan proposal'};
 if(body?.state!=='completed'||!docId(body.document_id)||!docId(body.pdf_id)||!str(body.title,160)||!str(body.summary,3000))return null;
 return {title:str(body.title,160),summary:str(body.summary,3000),document_id:body.document_id,pdf_id:body.pdf_id};
}
const view=row=>({...row,input:JSON.parse(row.input_json),result:row.result_json?JSON.parse(row.result_json):null,input_json:undefined,result_json:undefined});
export async function proposalRoute(c,action,method,body){
 if(method==='GET'){
  if(action==='proposal-list')return json({bridge_configured:bridgeConfigured(),proposals:(await q(c,"SELECT * FROM proposals ORDER BY created_at DESC,rowid DESC LIMIT 200")).rows.map(view)});
  if(action==='proposal-pending'){
   const id=body?.id;
   if(!uuid(id))return bad('ID proposal tidak valid');
   const rows=(await q(c,"SELECT * FROM proposals WHERE id=? AND state IN ('queued','published')",[id])).rows;
   return json({requests:rows.map(row=>({version:1,request_id:row.id,brand:{name:BRAND_NAME,website:BRAND_WEBSITE,contact:SENDER_NAME},proposal:JSON.parse(row.input_json)}))});
  }
  return bad('Method not allowed',405);
 }
 if(method!=='POST')return bad('Method not allowed',405);
 if(action==='proposal-create'||action==='proposal-revise'){
  let input=normalizeProposal(body),parent=null,leadId=null;
  if(action==='proposal-revise'){
   if(!uuid(body?.id)||!str(body?.revision,3000))return bad('ID dan instruksi revisi diperlukan');
   const old=(await q(c,'SELECT * FROM proposals WHERE id=?',[body.id])).rows[0];
   if(!old||!['completed','approved','failed'].includes(old.state))return bad('Proposal belum dapat direvisi',409);
   const previous=JSON.parse(old.input_json);
   input={...previous,revision:str(body.revision,3000),previous_result:old.result_json?JSON.parse(old.result_json):null};parent=old.id;leadId=old.lead_id;
  }else{
   if(!input)return bad('Periksa nama customer, project, harga, durasi dan URL');
   if(body.lead_id!=null&&body.lead_id!==''){
    leadId=Number(body.lead_id);
    if(!Number.isSafeInteger(leadId)||leadId<1||!(await q(c,'SELECT id FROM leads WHERE id=?',[leadId])).rows.length)return bad('Customer tidak ditemukan',404);
   }
  }
  const id=randomUUID();
  await q(c,'INSERT INTO proposals(id,parent_id,lead_id,customer,input_json) VALUES (?,?,?,?,?)',[id,parent,leadId,input.customer,JSON.stringify(input)]);
  return json({id,state:'queued',notified:await notifyBridge(id)});
 }
 const id=body?.request_id||body?.id;
 if(!uuid(id))return bad('ID proposal tidak valid');
 if(action==='proposal-dispatch'){
  const row=(await q(c,'SELECT state FROM proposals WHERE id=?',[id])).rows[0];
  if(!row||!['queued','published'].includes(row.state))return bad('Proposal tidak menunggu proses',409);
  return json({ok:true,notified:await notifyBridge(id)});
 }
 if(action==='proposal-published'){
  const r=await q(c,"UPDATE proposals SET state='published',updated_at=CURRENT_TIMESTAMP WHERE id=? AND state='queued'",[id]);
  return json({ok:true,changed:!!r.rowsAffected});
 }
 if(action==='proposal-result'){
  if(body.version!==1)return bad('Versi tidak valid');
  const result=normalizeResult(body);if(!result)return bad('Hasil proposal tidak valid');
  const next=body.state==='completed'?'completed':'failed';
  const row=(await q(c,'SELECT state,result_json FROM proposals WHERE id=?',[id])).rows[0];
  if(!row)return bad('Proposal tidak ditemukan',404);
  if(['completed','approved','failed'].includes(row.state))return row.result_json===JSON.stringify(result)?json({ok:true,replayed:true}):bad('Hasil berbeda untuk request yang sudah selesai',409);
  const r=await q(c,"UPDATE proposals SET state=?,result_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state IN ('queued','published')",[next,JSON.stringify(result),id]);
  return r.rowsAffected?json({ok:true}):bad('Status berubah; periksa hasil',409);
 }
 if(action==='proposal-approve'){
  const r=await q(c,"UPDATE proposals SET state='approved',updated_at=CURRENT_TIMESTAMP WHERE id=? AND state='completed'",[id]);
  return r.rowsAffected?json({ok:true}):bad('Proposal belum selesai',409);
 }
 return bad('Action tidak dikenal',404);
}
