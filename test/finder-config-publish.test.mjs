import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../integrations/leadflow-sync.gs', import.meta.url), 'utf8');
function fixture() {
  const config = {version:2,date:'2026-11-19',revision:'r1',batch_protocol:3,batch_size:10,campaigns:[{id:'a',enabled:true,daily_limit:20,added_today:0,remaining:20}]};
  const store = new Map(), sent = [];
  let fail = false;
  const props = {getProperty:k=>store.get(k),setProperty:(k,v)=>store.set(k,v)};
  const context = vm.createContext({
    console:{log(){}},
    UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify(config)})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(a,s)=>createHash(a).update(s).digest(),base64EncodeWebSafe:b=>b.toString('base64url')},
    GmailApp:{sendEmail:(...args)=>{if(fail)throw Error('send failed');sent.push(args);}},
  });
  vm.runInContext(source,context);
  return {config,store,sent,publish:()=>context.publishFinderConfig_(props,'test-token','owner@example.test'),fail:v=>{fail=v;}};
}
test('initial config sent, unchanged config skipped even after 24h',()=>{
  const f=fixture();f.publish();f.store.set('finder_config_sent_at',String(Date.now()-86400000));f.publish();assert.equal(f.sent.length,1);
});
test('updated remaining quota with same revision is published',()=>{
  const f=fixture();f.publish();f.config.campaigns[0].remaining=10;f.config.campaigns[0].added_today=10;f.publish();assert.equal(f.sent.length,2);
});
test('empty campaign transition published once',()=>{
  const f=fixture();f.publish();f.config.campaigns=[];f.publish();f.publish();assert.equal(f.sent.length,2);assert.deepEqual(JSON.parse(f.sent[1][2]).campaigns,[]);
});
test('new date published even when empty',()=>{
  const f=fixture();f.config.campaigns=[];f.publish();f.config.date='2026-11-20';f.publish();assert.equal(f.sent.length,2);assert.match(f.sent[1][1],/2026-11-20$/);
});
test('revision and batch size changes trigger publish',()=>{
  const f=fixture();f.publish();f.config.revision='r2';f.publish();f.config.batch_size=5;f.publish();assert.equal(f.sent.length,3);
});
test('send failure leaves previous hash intact for retry',()=>{
  const f=fixture();f.publish();const previous=f.store.get('finder_config_hash');f.config.revision='r2';f.fail(true);assert.throws(f.publish,/send failed/);assert.equal(f.store.get('finder_config_hash'),previous);f.fail(false);f.publish();assert.equal(f.sent.length,2);
});
