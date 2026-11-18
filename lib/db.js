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
   {sql:"CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL)"},
   {sql:"INSERT OR IGNORE INTO settings(key,value) VALUES ('paused','1')"}
  ],'write');
 })().catch(e=>{init=undefined;throw e});
 await init;return c;
}
