import {randomUUID} from 'node:crypto';
const query=(c,sql,args=[])=>c.execute({sql,args});
export const aiConfigured=()=>!!process.env.AI_BASE_URL&&!!process.env.AI_API_KEY&&!!process.env.AI_MODEL;
export async function withDraftLock(c,work){
 const token=randomUUID(),now=Date.now(), expires=now+90000;
 const r=await query(c,"INSERT INTO draft_worker_lock(id,token,expires_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE draft_worker_lock.expires_at<=?",[token,expires,now]);
 if(!r.rowsAffected)return null;
 try{return await work();}
 finally{await query(c,"DELETE FROM draft_worker_lock WHERE id=1 AND token=?",[token]).catch(()=>{});}
}
export async function runDraftQueue(c,generate){
 if(!aiConfigured())return {state:'unconfigured'};
 const result=await withDraftLock(c,async()=>{
  const now=Date.now();
  // Previous worker expired without recording the result. Never exceed three attempts.
  await query(c,"UPDATE draft_jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,last_error='Worker sebelumnya terhenti',next_at=?,updated_at=? WHERE state='generating'",[now,now]);
  const lead=(await query(c,"SELECT l.* FROM leads l LEFT JOIN lead_drafts d ON d.lead_id=l.id LEFT JOIN draft_jobs j ON j.lead_id=l.id WHERE l.status='new' AND l.blocked_at IS NULL AND d.lead_id IS NULL AND COALESCE(j.attempts,0)<3 AND COALESCE(j.next_at,0)<=? ORDER BY l.priority DESC,l.id ASC LIMIT 1",[now])).rows[0];
  if(!lead)return {state:'idle'};
  await query(c,"INSERT INTO draft_jobs(lead_id,attempts,state,next_at,updated_at) VALUES (?,1,'generating',0,?) ON CONFLICT(lead_id) DO UPDATE SET attempts=draft_jobs.attempts+1,state='generating',updated_at=excluded.updated_at,last_error=NULL",[lead.id,now]);
  try{
   const response=await generate(c,lead,{});
   if(response.ok){
    await query(c,"UPDATE draft_jobs SET state='ready',last_error=NULL,updated_at=? WHERE lead_id=?",[Date.now(),lead.id]);
    return {state:'ready'};
   }
   const body=await response.json();
   throw Error(typeof body.error==='string'?body.error:'AI generation failed');
  }catch(e){
   const job=(await query(c,"SELECT attempts FROM draft_jobs WHERE lead_id=?",[lead.id])).rows[0];
   const attempts=Number(job.attempts),state=attempts>=3?'failed':'pending';
   // Only our own sanitized error strings; do not save arbitrary provider data.
   const safe=String(e.message||'').match(/^(9Router HTTP \d{3}|9Router timeout|9Router tidak mengembalikan|Output AI terpotong|Output AI terlalu panjang|AI gagal pada tahap|Gagal menyimpan draft|ENV AI belum lengkap|Lead diblokir)/)?.[0]||'AI generation failed';
   const next=Date.now()+Math.min(30,attempts*10)*60000;
   await query(c,"UPDATE draft_jobs SET state=?,last_error=?,next_at=?,updated_at=? WHERE lead_id=?",[state,safe,next,Date.now(),lead.id]);
   return {state:state==='failed'?'failed':'retry',attempts};
  }
 });
 return result||{state:'busy'};
}
