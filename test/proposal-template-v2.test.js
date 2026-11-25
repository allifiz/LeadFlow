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
