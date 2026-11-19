import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {finderDay,blankCampaign,importCampaign,finderConfig,studio,saveBatchSize,saveCampaign} from '../lib/finder.js';
function setup(limit=6){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE finder_runs(campaign_id TEXT,campaign_name TEXT,day TEXT,revision TEXT,target INTEGER,found INTEGER,added INTEGER DEFAULT 0,duplicates INTEGER DEFAULT 0,invalid INTEGER DEFAULT 0,nonce TEXT UNIQUE,created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(campaign_id,day));
 CREATE TABLE finder_batches(batch_id TEXT PRIMARY KEY,campaign_id TEXT,day TEXT,revision TEXT,payload_hash TEXT,found INTEGER,added INTEGER DEFAULT 0,invalid INTEGER DEFAULT 0,duplicates INTEGER DEFAULT 0,nonce TEXT UNIQUE,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE leads(name TEXT,name_key TEXT UNIQUE,phone TEXT UNIQUE,email TEXT UNIQUE,category TEXT,location TEXT,source TEXT,priority INTEGER);`);
 const config={revision:'test-rev',campaigns:[{...blankCampaign,id:'demo',daily_limit:limit}]};
 db.prepare("INSERT INTO settings VALUES ('finder_config',?)").run(JSON.stringify(config));
 const execute=({sql,args=[]})=>{const stmt=db.prepare(sql);return /^SELECT/i.test(sql)?{rows:stmt.all(...args)}:{rows:[],rowsAffected:Number(stmt.run(...args).changes)}};
 const c={execute:async x=>execute(x),batch:async ops=>{db.exec('BEGIN');try{const results=ops.map(execute);db.exec('COMMIT');return results}catch(e){db.exec('ROLLBACK');throw e}}};
 const lead=n=>({name:'Business '+n,email:'business'+n+'@example.invalid',source:'https://example.invalid/'+n,priority:80});
 const body=(id,leads)=>({version:3,batch_id:'batch-unique-id-'+id,campaign_id:'demo',revision:'test-rev',date:finderDay(),leads});
 return {db,c,lead,body};
}
test('multiple batches, replay, capacity, duplicates and invalid rows',async()=>{
 const {db,c,lead,body}=setup();
 const first=body('one',[lead(1),lead(2),{name:'bad'}]);
 let r=await importCampaign(c,first);assert.equal(r.status,200);assert.deepEqual(await r.json(),{batch_id:first.batch_id,found:3,added:2,duplicates:0,invalid:1,replayed:false});
 assert.equal((await (await importCampaign(c,first)).json()).replayed,true);
 assert.equal((await importCampaign(c,{...first,leads:[lead(3)]})).status,409);
 assert.equal((await finderConfig(c,true)).campaigns[0].remaining,4);
 r=await importCampaign(c,body('two',[lead(2),lead(3),lead(4),lead(5)]));assert.equal(r.status,200);assert.equal((await r.json()).added,3);
 assert.equal((await finderConfig(c,true)).campaigns[0].remaining,1);
 assert.equal((await importCampaign(c,body('oversize',[lead(6),lead(7)]))).status,409);
 r=await importCampaign(c,body('three',[lead(6)]));assert.equal(r.status,200);
 assert.equal((await finderConfig(c,true)).campaigns.length,0);
 const h=(await studio(c)).history[0];assert.equal(h.added,6);assert.equal(h.found,8);assert.equal(h.duplicates,1);assert.equal(h.invalid,1);assert.equal(h.batches,3);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM leads').get().n,6);db.close();
});
test('legacy V2 import stays compatible and contributes to V3 remaining',async()=>{
 const {db,c,lead,body}=setup();
 const old={...body('old',[lead(1)]),version:2};delete old.batch_id;
 assert.equal((await importCampaign(c,old)).status,200);
 assert.equal((await finderConfig(c)).campaigns.length,0);
 assert.equal((await finderConfig(c,true)).campaigns[0].remaining,5);
 assert.equal((await importCampaign(c,body('new',[lead(2)]))).status,200);
 assert.equal((await studio(c)).history[0].added,2);db.close();
});

test('dynamic size, old GAS handshake, 10-lead import and revision guard',async()=>{
 const {db,c,lead,body}=setup(20);
 assert.equal((await finderConfig(c,true)).batch_size,5);
 assert.equal((await finderConfig(c,true,10)).batch_size,10);
 const ten=body('ten',Array.from({length:10},(_,i)=>lead(i+1)));
 assert.equal((await (await importCampaign(c,ten)).json()).added,10);
 assert.equal((await importCampaign(c,body('eleven',Array.from({length:11},(_,i)=>lead(i+11))))).status,400);
 assert.equal((await saveBatchSize(c,{revision:'test-rev',batch_size:7})).status,400);
 const change=await (await saveBatchSize(c,{revision:'test-rev',batch_size:5})).json();
 assert.equal(change.batch_size,5);
 assert.equal((await finderConfig(c,true,10)).batch_size,5);
 assert.equal((await importCampaign(c,body('stale',[lead(11)]))).status,409);
 assert.equal((await importCampaign(c,{...body('six',Array.from({length:6},(_,i)=>lead(i+11))),revision:change.revision})).status,400);
 assert.equal((await (await importCampaign(c,ten)).json()).replayed,true);
 const config=await studio(c);
 const saved=await saveCampaign(c,{revision:change.revision,campaign:{...config.campaigns[0],name:'Updated'}});
 assert.equal(saved.status,200);assert.equal((await finderConfig(c,true,10)).batch_size,5);
 db.close();
});
