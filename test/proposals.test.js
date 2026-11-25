import test from 'node:test';
import assert from 'node:assert/strict';
import {draft,composeAiDraft,brandedSavedDraft} from '../lib/core.js';
import {normalizeProposal,normalizeResult,proposalRoute,proposalSchema} from '../lib/proposals.js';
import {DatabaseSync} from 'node:sqlite';
test('new and legacy open drafts contain brand, historic draft stays unchanged',()=>{
 const lead={name:'Example',status:'new',category:'cafe'};
 for(let i=1;i<=9;i++)assert.match(draft(lead,'2026-11-0'+i),/Sangkara Karya/);
 assert.match(composeAiDraft(lead,'Kami dapat membuat website.'),/Sangkara Karya/);
 const saved_draft='Halo tim Example. Perkenalkan, saya Muhammad Allief, web developer asal Garut.\n\nPesan.';
 assert.match(brandedSavedDraft({...lead,saved_draft}),/Sangkara Karya/);
 assert.equal(brandedSavedDraft({...lead,status:'manual',saved_draft}),saved_draft);
});
const input={customer:'Test',project:'Website',budget:1500000,duration:14,website:'https://example.test/'};
test('validate proposal input and result',()=>{
 assert.equal(normalizeProposal(input).budget,1500000);
 assert.equal(normalizeProposal({...input,budget:-1}),null);
 assert.equal(normalizeProposal({...input,website:'javascript:alert(1)'}),null);
 assert.equal(normalizeResult({state:'completed',document_id:'fake'}),null);
});
test('queue, publish, result replay, approval and revision are additive',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE leads(id INTEGER PRIMARY KEY);'+proposalSchema.sql);
 const c={execute:async({sql,args=[]})=>/^SELECT/i.test(sql)?{rows:db.prepare(sql).all(...args)}:{rowsAffected:Number(db.prepare(sql).run(...args).changes)}};
 const call=async(action,method,body)=>{const r=await proposalRoute(c,action,method,body);return {status:r.status,data:await r.json()};};
 const {data:{id}}=await call('proposal-create','POST',input);
 assert.equal((await call('proposal-pending','GET',{id})).data.requests[0].request_id,id);
 assert.equal((await call('proposal-published','POST',{request_id:id})).status,200);
 const result={version:1,request_id:id,state:'completed',document_id:'abcdefghijk123456',pdf_id:'abcdefghijk123457',title:'Test',summary:'Proposal'};
 assert.equal((await call('proposal-result','POST',result)).status,200);
 assert.equal((await call('proposal-result','POST',result)).data.replayed,true);
 assert.equal((await call('proposal-result','POST',{...result,title:'Changed'})).status,409);
 assert.equal((await call('proposal-approve','POST',{id})).status,200);
 const revised=await call('proposal-revise','POST',{id,revision:'Change scope'});
 assert.notEqual(revised.data.id,id);
 const rows=(await call('proposal-list','GET')).data.proposals;
 assert.equal(rows.length,2);assert.equal(rows.find(x=>x.id===id).state,'approved');assert.equal(rows.find(x=>x.id===revised.data.id).parent_id,id);
 db.close();
});
