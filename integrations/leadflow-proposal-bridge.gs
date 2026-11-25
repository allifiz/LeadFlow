// Deploy as a NEW standalone Apps Script Web App, execute as owner.
// Script Properties: PROPOSAL_ENDPOINT, PROPOSAL_BRIDGE_TOKEN, PROPOSAL_WEBHOOK_SECRET,
// PROPOSAL_OWNER_EMAIL, PROPOSAL_FOLDER_ID (private Drive folder); optional PROPOSAL_VERCEL_BYPASS.
const REQ='LEADFLOW_PROPOSAL_REQUEST_V1', RES='LEADFLOW_PROPOSAL_RESULT_V1', PENDING='proposal_pending_', SENT='proposal_sent_';
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
 if(!cfg.p.getProperty(SENT+id)){
  if(!sent_(cfg,subject).length)GmailApp.sendEmail(cfg.owner,subject,JSON.stringify(found.requests[0]));
  cfg.p.setProperty(SENT+id,'1');
 }
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
function result_(cfg,id,req){
 const msgs=sent_(cfg,RES+' '+id);
 if(!msgs.length)return null;
 for(const m of msgs.reverse()){
  let r;try{r=JSON.parse(m.getPlainBody().trim());}catch{continue;}
  if(r.version!==1||r.request_id!==id)continue;
  if(r.state==='failed')return {version:1,request_id:id,state:'failed',error:String(r.error||'GPT failed').slice(0,500)};
  if(r.state!=='completed'||typeof r.title!=='string'||!r.title.trim()||typeof r.summary!=='string'||!r.summary.trim())continue;
  const isV2=r.format==='template-v2';
  if(!isV2&&!(/^[A-Za-z0-9_-]{15,150}$/).test(r.document_id||''))continue;
  const doc=isV2?renderTemplate_(cfg,id,req,r):DriveApp.getFileById(r.document_id);
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
    if(!pending.requests.length){cfg.p.deleteProperty(key);cfg.p.deleteProperty(SENT+id);cfg.p.deleteProperty('proposal_rendered_'+id);continue;}
    const found=result_(cfg,id,pending.requests[0]);
    if(found){api_(cfg,'proposal-result',found);cfg.p.deleteProperty(key);cfg.p.deleteProperty(SENT+id);cfg.p.deleteProperty('proposal_rendered_'+id);continue;}
    if(Date.now()-Number(started)>48*3600000){api_(cfg,'proposal-result',{version:1,request_id:id,state:'failed',error:'Tidak ada hasil GPT dalam 48 jam. Buat revisi untuk mencoba lagi.'});cfg.p.deleteProperty(key);cfg.p.deleteProperty(SENT+id);cfg.p.deleteProperty('proposal_rendered_'+id);continue;}
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


// V2: GPT returns content, GAS owns the layout. The old document_id result remains supported.
function templateFields_(req,r){
 const p=req.proposal,c=r.content;
 if(!c||typeof c!=='object')throw Error('V2 content missing');
 const safe=(s,max,key)=>{if(typeof s!=='string'||!s.trim()||s.length>max||/[{}]/.test(s))throw Error('Invalid V2 field: '+key);return s.trim();};
 const v=(k,n)=>safe(c[k],n,k);
 const budget=Number(p.budget),duration=Number(p.duration);
 if(!Number.isSafeInteger(budget)||budget<0||!Number.isSafeInteger(duration)||duration<1)throw Error('Invalid commercial brief');
 const money='Rp'+String(budget).replace(/\B(?=(\d{3})+(?!\d))/g,'.');
 return {PROJECT_TITLE:safe(p.project,160,'project'),CUSTOMER:safe(p.customer,160,'customer'),INVESTMENT:money,DURATION:duration+' hari',DATE:Utilities.formatDate(new Date(),'Asia/Jakarta','dd/MM/yyyy'),REFERENCE:req.request_id.slice(0,8).toUpperCase(),
 CONTEXT:v('context',500),SOLUTION:v('solution',550),OUTCOMES:v('outcomes',450),SCOPE:v('scope',1800),BOUNDARIES:v('boundaries',550),TIMELINE:v('timeline',850),DEPENDENCIES:v('dependencies',450),PAYMENT:v('payment',650),REFERENCES:v('references',1200),NEXT_STEPS:v('next_steps',450)};
}
function renderTemplate_(cfg,id,req,r){
 const values=templateFields_(req,r);
 const templateId=cfg.p.getProperty('PROPOSAL_TEMPLATE_ID')||'';
 if(!/^[A-Za-z0-9_-]{15,150}$/.test(templateId))throw Error('Configure PROPOSAL_TEMPLATE_ID');
 const master=DriveApp.getFileById(templateId),folder=DriveApp.getFolderById(cfg.folder);
 if(master.getMimeType()!==MimeType.GOOGLE_DOCS||master.getOwner()?.getEmail().toLowerCase()!==cfg.owner||master.getSharingAccess()!==DriveApp.Access.PRIVATE||folder.getSharingAccess()!==DriveApp.Access.PRIVATE)throw Error('Template or folder must be private and owned by bridge account');
 const title='Sangkara Karya - Proposal V2 - '+id,existing=folder.getFilesByName(title);
 // Reuse only a finished copy, never edit the master or a previous proposal.
 const done=cfg.p.getProperty('proposal_rendered_'+id);
 if(done){const ready=DriveApp.getFileById(done);if(ready.getName()===title&&!ready.isTrashed())return ready;throw Error('Rendered document missing');}
 let copy=null;
 try{
  while(existing.hasNext()){const orphan=existing.next();if(orphan.getMimeType()===MimeType.GOOGLE_DOCS&&orphan.getOwner()?.getEmail().toLowerCase()===cfg.owner)orphan.setTrashed(true);}
  copy=master.makeCopy(title,folder);
  const doc=DocumentApp.openById(copy.getId()),body=doc.getBody();
  for(const [k,value] of Object.entries(values)){
   const pattern='\\{\\{'+k+'\\}\\}',count=(body.getText().match(new RegExp(pattern,'g'))||[]).length;
   if(!count)throw Error('Missing master placeholder: '+k);
   // Literal replacement, preserving the placeholder character attributes.
   for(let i=0;i<count;i++){
    const match=body.findText(pattern);if(!match)throw Error('Placeholder lookup failed: '+k);
    const t=match.getElement().asText(),start=match.getStartOffset(),end=match.getEndOffsetInclusive(),attrs=t.getAttributes(start);
    t.insertText(start,value);t.deleteText(start+value.length,end+value.length);t.setAttributes(start,start+value.length-1,attrs);
   }
  }
  if(/\{\{[A-Z_]+\}\}/.test(body.getText()))throw Error('Unresolved master placeholders');
  doc.saveAndClose();
  cfg.p.setProperty('proposal_rendered_'+id,copy.getId());
  return copy;
 }catch(e){if(copy)copy.setTrashed(true);throw e;}
}
function authorizeProposalTemplate(){
 const cfg=config_(),id=cfg.p.getProperty('PROPOSAL_TEMPLATE_ID')||'';
 const file=DriveApp.getFileById(id);
 if(file.getMimeType()!==MimeType.GOOGLE_DOCS||file.getOwner()?.getEmail().toLowerCase()!==cfg.owner||file.getSharingAccess()!==DriveApp.Access.PRIVATE)throw Error('Master template must be a private Google Doc owned by bridge account');
 const body=DocumentApp.openById(id).getBody();
 if(!body.getText().includes('{{PROJECT_TITLE}}'))throw Error('Master template placeholders missing');
 console.log('Proposal Template V2 authorized; no proposal created.');
}
