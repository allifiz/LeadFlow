import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({Utilities:{formatDate:()=> '25/11/2026'}});
vm.runInContext(readFileSync(new URL('../integrations/leadflow-proposal-bridge.gs',import.meta.url),'utf8'),ctx);
const req={request_id:'d619b7b6-d52b-44ca-8f5d-32587652f2e1',proposal:{customer:'Aurora Catering',project:'Website',budget:2500000,duration:14}};
const content={context:'Kebutuhan',solution:'Solusi',outcomes:'Manfaat',scope:'Homepage\nKatalog',boundaries:'Disepakati',timeline:'14 hari',dependencies:'Materi',payment:'50%',references:'Tidak ada',next_steps:'Konfirmasi'};
test('V2 template fields retain authoritative commercial input and all placeholders',()=>{
 const result=ctx.templateFields_(req,{content:{...content,INVESTMENT:'Rp0'}});
 assert.equal(result.INVESTMENT,'Rp2.500.000');assert.equal(result.DURATION,'14 hari');assert.equal(result.REFERENCE,'D619B7B6');assert.equal(result.SCOPE,'Homepage\nKatalog');assert.equal(Object.keys(result).length,16);
});
test('V2 rejects missing, oversized, or placeholder-injected content',()=>{
 assert.throws(()=>ctx.templateFields_(req,{content:{...content,scope:''}}),/scope/);
 assert.throws(()=>ctx.templateFields_(req,{content:{...content,scope:'x'.repeat(1801)}}),/scope/);
 assert.throws(()=>ctx.templateFields_(req,{content:{...content,context:'{{INVESTMENT}}'}}),/context/);
});


test('V2 renderer fills repeated placeholders, preserves master, and reuses finished copy',()=>{
 const source=readFileSync(new URL('../integrations/leadflow-proposal-bridge.gs',import.meta.url),'utf8');
 const masterId='master-template-123456',docId='rendered-document-123456',owner='test@example.com';
 const initial='{{PROJECT_TITLE}}\n{{CUSTOMER}}\n{{INVESTMENT}}\n{{DURATION}}\n{{DATE}}\n{{REFERENCE}}\n{{CONTEXT}}\n{{SOLUTION}}\n{{OUTCOMES}}\n{{SCOPE}}\n{{BOUNDARIES}}\n{{TIMELINE}}\n{{DEPENDENCIES}}\n{{PAYMENT}}\n{{REFERENCES}}\n{{NEXT_STEPS}}\n{{INVESTMENT}}\n{{DURATION}}';
 let draft=initial,copies=0,saved=0,attrs=0,trashed=false;
 const file={getMimeType:()=> 'doc',getOwner:()=>({getEmail:()=>owner}),getSharingAccess:()=> 'private',getName:()=> 'Sangkara Karya - Proposal V2 - '+req.request_id,getId:()=>docId,isTrashed:()=>trashed,setTrashed:v=>{trashed=v}};
 const master={...file,getId:()=>masterId,makeCopy:()=>{copies++;return file;}};
 const folder={getSharingAccess:()=> 'private',getFilesByName:()=>({hasNext:()=>false})};
 const p=new Map([['PROPOSAL_TEMPLATE_ID',masterId]]);
 const element={asText:()=>element,getAttributes:()=>({bold:true}),insertText:(i,v)=>{draft=draft.slice(0,i)+v+draft.slice(i);},deleteText:(a,b)=>{draft=draft.slice(0,a)+draft.slice(b+1);},setAttributes:()=>{attrs++;}};
 const body={getText:()=>draft,findText:pattern=>{const m=new RegExp(pattern).exec(draft);return m?{getElement:()=>element,getStartOffset:()=>m.index,getEndOffsetInclusive:()=>m.index+m[0].length-1}:null;}};
 const runtime=vm.createContext({Utilities:{formatDate:()=> '25/11/2026'},MimeType:{GOOGLE_DOCS:'doc'},DriveApp:{Access:{PRIVATE:'private'},getFileById:id=>id===masterId?master:file,getFolderById:()=>folder},DocumentApp:{openById:()=>({getBody:()=>body,saveAndClose:()=>saved++})}});
 vm.runInContext(source,runtime);
 const cfg={owner,folder:'folder',p:{getProperty:k=>p.get(k),setProperty:(k,v)=>p.set(k,v)}};
 const first=runtime.renderTemplate_(cfg,req.request_id,req,{content});
 assert.equal(first.getId(),docId);
 assert.equal(copies,1);assert.equal(saved,1);assert.equal(attrs,18);assert.equal(trashed,false);
 assert.equal((draft.match(/Rp2\.500\.000/g)||[]).length,2);
 assert.equal((draft.match(/14 hari/g)||[]).length,3);
 assert.match(draft,/Homepage\nKatalog/);assert.doesNotMatch(draft,/\{\{[A-Z_]+\}\}/);
 assert.equal(runtime.renderTemplate_(cfg,req.request_id,req,{content}).getId(),docId);assert.equal(copies,1);
});
