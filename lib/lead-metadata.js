// Additive, repeatable migration. Never invent historical contact or campaign data.
export const leadMetadataColumns={
 campaign_id:'TEXT',campaign_name:'TEXT',batch_id:'TEXT',contacted_at:'TEXT',contact_channel:'TEXT',updated_at:'TEXT'
};
export async function ensureLeadMetadata(c){
 const columns=async()=>new Set((await c.execute({sql:'PRAGMA table_info(leads)',args:[]})).rows.map(r=>r.name));
 const known=await columns();
 for(const [name,type] of Object.entries(leadMetadataColumns)){
  if(known.has(name))continue;
  try{await c.execute({sql:'ALTER TABLE leads ADD COLUMN '+name+' '+type,args:[]});}
  catch(error){if(!(await columns()).has(name))throw error;}
 }
 await c.batch([
  {sql:"CREATE TRIGGER IF NOT EXISTS leadflow_status_updated_v1 AFTER UPDATE OF status ON leads WHEN OLD.status<>NEW.status BEGIN UPDATE leads SET updated_at=CURRENT_TIMESTAMP WHERE id=NEW.id; END"},
  {sql:"CREATE INDEX IF NOT EXISTS leads_status_created ON leads(status,created_at,id)"}
 ],'write');
}
export const contactChannels=['whatsapp','email','phone','manual'];
export function manualChannel(value){return contactChannels.includes(value)?value:'manual';}
