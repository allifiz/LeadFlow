import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {customerView,jakartaDay,historyEvent,selectCustomers} from '../public/customer-workspace.js';
import {ensureLeadMetadata,manualChannel} from '../lib/lead-metadata.js';
test('queue, history and review are mutually exclusive; Jakarta date and ordering',()=>{
 const leads=[{id:1,status:'new',created_at:'2026-11-18 16:59:00'},{id:2,status:'new',created_at:'2026-11-18 17:01:00',campaign_id:'a'},{id:3,status:'manual',created_at:'2026-11-19 01:00:00'},{id:4,status:'submitted',attempt_at:'2026-11-19 02:00:00'},{id:5,status:'unknown'},{id:6,status:'blocked',blocked_at:'2026-11-19 03:00:00'},{id:7,status:'sending'},{id:8,status:'new',created_at:'2026-11-19 05:00:00',campaign_id:'b'}];
 assert.equal(jakartaDay(leads[1].created_at),'2026-11-19');
 assert.deepEqual(selectCustomers(leads,{view:'queue',period:'today',today:'2026-11-19'}).map(l=>l.id),[8,2]);
 assert.deepEqual(selectCustomers(leads,{view:'queue',period:'older',today:'2026-11-19'}).map(l=>l.id),[1]);
 assert.deepEqual(selectCustomers(leads,{view:'history'}).map(l=>l.id),[6,4,3]);
 assert.deepEqual(selectCustomers(leads,{view:'review'}).map(l=>l.id),[7,5]);
 assert.equal(historyEvent(leads[2]).at,null);
 assert.equal(historyEvent(leads[3]).label,'Percobaan pengiriman');
 assert.equal(customerView({...leads[0],status:'new',blocked_at:'2026-11-19'}),'history');
 assert.equal(selectCustomers(leads,{view:'queue',campaign:'a'}).length,1);
 assert.equal(selectCustomers(leads,{view:'history',channel:'whatsapp'}).length,1);
});
test('metadata migration is additive, repeatable, and does not invent legacy timestamps',async()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE leads(id INTEGER PRIMARY KEY,status TEXT,created_at TEXT); INSERT INTO leads VALUES(1,'manual','2026-11-18 04:00:00')");
 const c={execute:async({sql,args=[]})=>/^(PRAGMA|SELECT)/i.test(sql)?{rows:db.prepare(sql).all(...args)}:{rows:[],rowsAffected:Number(db.prepare(sql).run(...args).changes)},batch:async ops=>ops.map(x=>db.exec(x.sql))};
 await ensureLeadMetadata(c);await ensureLeadMetadata(c);
 const old=db.prepare('SELECT * FROM leads').get();assert.equal(old.status,'manual');assert.equal(old.contacted_at,null);assert.equal(old.campaign_id,null);
 db.exec("UPDATE leads SET status='blocked' WHERE id=1");assert.ok(db.prepare('SELECT updated_at FROM leads').get().updated_at);
 assert.equal(manualChannel('email'),'email');assert.equal(manualChannel('bad'),'manual');db.close();
});
