// Deploy as a NEW standalone Apps Script Web App, execute as owner.
// Script Properties: PROPOSAL_ENDPOINT, PROPOSAL_BRIDGE_TOKEN, PROPOSAL_WEBHOOK_SECRET,
// PROPOSAL_OWNER_EMAIL, PROPOSAL_FOLDER_ID (private Drive folder); optional PROPOSAL_VERCEL_BYPASS.
const REQ='LEADFLOW_PROPOSAL_REQUEST_V1', RES='LEADFLOW_PROPOSAL_RESULT_V1', PENDING='proposal_pending_';
const uuid_=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
function config_(){
 const p=PropertiesService.getScriptProperties(),get=k=>p.getProperty(k)||'';
 const endpoint=get('PROPOSAL_ENDPOINT'),owner=get('PROPOSAL_OWNER_EMAIL').trim().toLowerCase(),token=get('PROPOSAL_BRIDGE_TOKEN'),secret=get('PROPOSAL_WEBHOOK_SECRET'),folder=get('PROPOSAL_FOLDER_ID');
 if(!/^https:\/\/[a-z0-9-]+\.vercel\.app\/api\/leadflow$/.test(endpoint)||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).test(owner)||token.length<32||secret.length<32||!(/^[A-Za-z0-9_-]{15,150}$/).test(folder))throw Error('Proposal bridge configuration incomplete');
 return {p,endpoint,owner,token,secret,folder,bypass:get('PROPOSAL_VERCEL_BYPASS')};
}
function equal_(a,b){
 if(typeof a!=='string'||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
function output_(body){return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);}
function api_(cfg,action,body){
 const headers={Authorization:'Bearer '+cfg.token};
 if(cfg.bypass)headers['x-vercel-protection-bypass']=cfg.bypass;
 const r=UrlFetchApp.fetch(cfg.endpoint+'?action='+action,{method:body?'post':'get',headers,contentType:'application/json',...(body?{payload:JSON.stringify(body)}:{}),muteHttpExceptions:true,followRedirects:false});
 if(r.getResponseCode()!==200)throw Error('LeadFlow HTTP '+r.getResponseCode());
 return JSON.parse(r.getContentText());
}
function sent_(cfg,subject){
 const address=s=>(String(s||'').match(/<([^<>]+)>/)?.[1]||String(s||'')).trim().toLowerCase();
 return GmailApp.search('in:sent to:'+cfg.owner+' subject:"'+subject+'"',0,20).flatMap(t=>t.getMessages()).filter(m=>m.getSubject()===subject&&address(m.getFrom())===cfg.owner&&address(m.getTo())===cfg.owner);
}
function ensureTrigger_(){
 if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='pollProposalResults'))ScriptApp.newTrigger('pollProposalResults').timeBased().everyMinutes(1).create();
}
function stopTriggerIfIdle_(cfg){
 if(Object.keys(cfg.p.getProperties()).some(k=>k.startsWith(PENDING)))return;
 for(const t of ScriptApp.getProjectTriggers())if(t.getHandlerFunction()==='pollProposalResults')ScriptApp.deleteTrigger(t);
}
function publish_(cfg,id){
 const found=api_(cfg,'proposal-pending&id='+encodeURIComponent(id));
 if(!Array.isArray(found.requests)||found.requests.length!==1||found.requests[0].request_id!==id)throw Error('Proposal not pending');
 const key=PENDING+id,subject=REQ+' '+id;
 if(!cfg.p.getProperty(key))cfg.p.setProperty(key,String(Date.now()));
 ensureTrigger_();
 if(!sent_(cfg,subject).length)GmailApp.sendEmail(cfg.owner,subject,JSON.stringify(found.requests[0]));
 api_(cfg,'proposal-published',{request_id:id});
}
function doPost(e){
 const lock=LockService.getScriptLock();
 try{
  const cfg=config_(),raw=e?.postData?.contents||'';
  if(raw.length>2000)return output_({ok:false});
  const body=JSON.parse(raw);
  if(!equal_(body.secret,cfg.secret)||!uuid_(body.request_id))return output_({ok:false});
  if(!lock.tryLock(1000))return output_({ok:false,retry:true});
  try{publish_(cfg,body.request_id);return output_({ok:true});}finally{lock.releaseLock();}
 }catch(e){console.warn('Proposal webhook failed: '+String(e.message||e).slice(0,100));return output_({ok:false});}
}
function result_(cfg,id){
 const msgs=sent_(cfg,RES+' '+id);
 if(!msgs.length)return null;
 for(const m of msgs.reverse()){
  let r;try{r=JSON.parse(m.getPlainBody().trim());}catch{continue;}
  if(r.version!==1||r.request_id!==id)continue;
  if(r.state==='failed')return {version:1,request_id:id,state:'failed',error:String(r.error||'GPT failed').slice(0,500)};
  if(r.state!=='completed'||!(/^[A-Za-z0-9_-]{15,150}$/).test(r.document_id||'')||typeof r.title!=='string'||!r.title.trim()||typeof r.summary!=='string'||!r.summary.trim())continue;
  const doc=DriveApp.getFileById(r.document_id);
  if(doc.getMimeType()!==MimeType.GOOGLE_DOCS||doc.getOwner()?.getEmail().toLowerCase()!==cfg.owner||!doc.getName().includes(id))throw Error('Invalid proposal document ownership or name');
  const folder=DriveApp.getFolderById(cfg.folder);
  if(folder.getSharingAccess()!==DriveApp.Access.PRIVATE)throw Error('Proposal folder must be private');
  if(doc.getSharingAccess()!==DriveApp.Access.PRIVATE)throw Error('Proposal document must be private');
  const name='Sangkara Karya - '+id+'.pdf',files=folder.getFilesByName(name);
  const pdf=files.hasNext()?files.next():folder.createFile(doc.getAs(MimeType.PDF).setName(name));
  return {version:1,request_id:id,state:'completed',title:r.title.slice(0,160),summary:r.summary.slice(0,3000),document_id:doc.getId(),pdf_id:pdf.getId()};
 }
 return null;
}
function pollProposalResults(){
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
 try{
  const cfg=config_();
  for(const [key,started] of Object.entries(cfg.p.getProperties()).filter(([k])=>k.startsWith(PENDING)).slice(0,10)){
   const id=key.slice(PENDING.length);if(!uuid_(id))continue;
   try{
    const pending=api_(cfg,'proposal-pending&id='+encodeURIComponent(id));
    if(!pending.requests.length){cfg.p.deleteProperty(key);continue;}
    const found=result_(cfg,id);
    if(found){api_(cfg,'proposal-result',found);cfg.p.deleteProperty(key);continue;}
    if(Date.now()-Number(started)>48*3600000){api_(cfg,'proposal-result',{version:1,request_id:id,state:'failed',error:'Tidak ada hasil GPT dalam 48 jam. Buat revisi untuk mencoba lagi.'});cfg.p.deleteProperty(key);continue;}
    publish_(cfg,id);
   }catch(e){console.warn('Proposal pending: '+id+' '+String(e.message||e).slice(0,100));}
  }
  stopTriggerIfIdle_(cfg);
 }finally{lock.releaseLock();}
}
// Run once manually to authorize Gmail, Drive, UrlFetch and ScriptApp. No emails sent.
function authorizeProposalBridge(){
 const cfg=config_();
 GmailApp.getAliases();DriveApp.getFolderById(cfg.folder).getName();ScriptApp.getProjectTriggers();
 console.log('Proposal bridge configuration read; deploy web app and test through LeadFlow.');
}
