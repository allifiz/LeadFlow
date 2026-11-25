import {proposalSchema} from './proposals.js';
import {blankCampaign} from './finder.js';
import {ensureLeadMetadata} from './lead-metadata.js';
import {createClient} from '@libsql/client/web';
let client, init;
export function db(){
 if(!process.env.TURSO_DATABASE_URL || (!process.env.TURSO_AUTH_TOKEN && process.env.NODE_ENV==='production')) throw Error('Database belum dikonfigurasi');
 if(!client) client=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});
 return client;
}
export async function ready(){
 const c=db();
 if(!init) init=(async()=>{
  await c.batch([
   {sql:"CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,phone TEXT UNIQUE,email TEXT UNIQUE,category TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',source TEXT NOT NULL DEFAULT '',priority INTEGER NOT NULL DEFAULT 50,status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','sending','submitted','unknown','manual','blocked')),wa_verified INTEGER NOT NULL DEFAULT 0,opt_in_at TEXT,opt_in_evidence TEXT,blocked_at TEXT,provider_id TEXT,last_error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"},
   {sql:"CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY AUTOINCREMENT,lead_id INTEGER NOT NULL UNIQUE REFERENCES leads(id),day TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,template TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'sending',provider_id TEXT)"},
   {sql:"CREATE INDEX IF NOT EXISTS attempts_day ON attempts(day)"},
   {sql:"CREATE TABLE IF NOT EXISTS lead_drafts (lead_id INTEGER PRIMARY KEY REFERENCES leads(id),message TEXT NOT NULL,model TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"},
   {sql:"CREATE TABLE IF NOT EXISTS draft_jobs (lead_id INTEGER PRIMARY KEY REFERENCES leads(id),attempts INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'pending',next_at INTEGER NOT NULL DEFAULT 0,last_error TEXT,updated_at INTEGER NOT NULL DEFAULT 0)"},
   {sql:"CREATE TABLE IF NOT EXISTS draft_worker_lock (id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,expires_at INTEGER NOT NULL)"},
   {sql:"CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL)"},
   {sql:"INSERT OR IGNORE INTO settings(key,value) VALUES ('paused','1')"},
   {sql:"CREATE TABLE IF NOT EXISTS finder_runs (campaign_id TEXT NOT NULL,campaign_name TEXT NOT NULL,day TEXT NOT NULL,revision TEXT NOT NULL,target INTEGER NOT NULL,found INTEGER NOT NULL,added INTEGER NOT NULL DEFAULT 0,duplicates INTEGER NOT NULL DEFAULT 0,invalid INTEGER NOT NULL DEFAULT 0,nonce TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(campaign_id,day))"},
   {sql:"CREATE TABLE IF NOT EXISTS finder_batches (batch_id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,day TEXT NOT NULL,revision TEXT NOT NULL,payload_hash TEXT NOT NULL,found INTEGER NOT NULL,added INTEGER NOT NULL DEFAULT 0,invalid INTEGER NOT NULL DEFAULT 0,duplicates INTEGER NOT NULL DEFAULT 0,nonce TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"},
   {sql:"CREATE INDEX IF NOT EXISTS finder_batches_campaign_day ON finder_batches(campaign_id,day)"},
   {sql:"INSERT OR IGNORE INTO settings(key,value) VALUES ('finder_config',?)",args:[JSON.stringify({revision:'initial-v2',campaigns:[{id:'garut-default',...blankCampaign}]})]}
  ],'write');
  await ensureLeadMetadata(c);
  await c.execute(proposalSchema);
 })().catch(e=>{init=undefined;throw e});
 await init;return c;
}
