// Add the advanced Gmail API service in Apps Script before running.
// Script Properties: LEADFLOW_IMPORT_TOKEN (same as Vercel IMPORT_TOKEN).
// Optional LEADFLOW_VERCEL_BYPASS only if explicitly configured in Vercel.
const LEADFLOW_ENDPOINT = 'https://leadflow-topaz-eta.vercel.app/api/leadflow?action=import';
// Owner email is configured privately as LEADFLOW_OWNER_EMAIL.
const PREFIX = 'LEADFLOW_SYNC_V1';
function installLeadFlowSync() {
  const config = PropertiesService.getScriptProperties();
  if (!config.getProperty('LEADFLOW_IMPORT_TOKEN') || !config.getProperty('LEADFLOW_OWNER_EMAIL')) throw new Error('Set LEADFLOW_IMPORT_TOKEN and LEADFLOW_OWNER_EMAIL first');
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'syncLeadFlow') ScriptApp.deleteTrigger(trigger);
  }
  ScriptApp.newTrigger('syncLeadFlow').timeBased().everyMinutes(10).create();
}
function syncLeadFlow() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('LEADFLOW_IMPORT_TOKEN');
    if (!token || token.length < 24) throw new Error('Missing import token');
    const OWNER = (props.getProperty('LEADFLOW_OWNER_EMAIL') || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(OWNER)) throw new Error('Missing owner email');
    const cutoff = Date.now() - 30 * 86400000;
    for (const [key,value] of Object.entries(props.getProperties())) {
      if (key.startsWith('done_') && Number(value) < cutoff) props.deleteProperty(key);
    }
    let pageToken;
    let pages = 0;
    do {
      const result = Gmail.Users.Messages.list('me', {
        labelIds:['SENT'], q:'to:'+OWNER+' subject:'+PREFIX+' newer_than:14d',
        maxResults:100, ...(pageToken ? {pageToken}: {})
      });
      for (const item of result.messages || []) {
        const key = 'done_'+item.id;
        if (props.getProperty(key)) continue;
        try {
          const msg = Gmail.Users.Messages.get('me',item.id,{format:'full'});
          if (!(msg.labelIds || []).includes('SENT')) continue;
          const headers = Object.fromEntries((msg.payload.headers||[]).map(x=>[x.name.toLowerCase(),x.value]));
          const address = s => (String(s||'').match(/<([^<>]+)>/)?.[1]||String(s||'')).trim().toLowerCase();
          if (address(headers.from)!==OWNER || address(headers.to)!==OWNER || !/^LEADFLOW_SYNC_V1 \d{4}-\d{2}-\d{2}$/.test(headers.subject||'')) continue;
          const plain = findPlain(msg.payload);
          const payload = JSON.parse(plain.trim());
          if (payload.version!==1 || !Array.isArray(payload.leads) || payload.leads.length>20) throw new Error('Invalid batch');
          // Never import claimed opt-in, status, secrets or other unexpected fields.
          const leads = payload.leads.map(l=>({name:l.name,phone:l.phone,email:l.email,category:l.category,location:l.location,source:l.source,priority:l.priority}));
          const headersOut = {Authorization:'Bearer '+token};
          const bypass = props.getProperty('LEADFLOW_VERCEL_BYPASS');
          if (bypass) headersOut['x-vercel-protection-bypass']=bypass;
          const response = UrlFetchApp.fetch(LEADFLOW_ENDPOINT,{
            method:'post',contentType:'application/json',headers:headersOut,
            payload:JSON.stringify({leads}),muteHttpExceptions:true,followRedirects:false
          });
          if (response.getResponseCode()!==200) throw new Error('LeadFlow HTTP '+response.getResponseCode());
          const r=JSON.parse(response.getContentText());
          if (!Number.isInteger(r.added)||!Number.isInteger(r.duplicates)||!Array.isArray(r.errors)||r.added+r.duplicates+r.errors.length!==leads.length) throw new Error('Unexpected response');
          props.setProperty(key,String(Date.now()));
          console.log('Batch imported: added='+r.added+' duplicates='+r.duplicates+' invalid='+r.errors.length);
          if(r.errors.length) console.warn('Invalid rows: '+r.errors.map(x=>x.index).join(','));
        } catch(e) { console.warn('Batch not confirmed: '+String(e.message||e).slice(0,120)); }
      }
      pageToken=result.nextPageToken;
    } while(pageToken && ++pages<3);
  } finally {lock.releaseLock();}
}
function findPlain(part) {
  if (part.mimeType === 'text/plain' && part.body?.data) {
    const raw = String(part.body.data).trim();
    // Some wrappers expose an already-decoded JSON body.
    if (raw.startsWith('{')) return raw;
    // Accept both URL-safe and standard base64, with or without padding.
    const encoded = raw.replace(/\s/g, '')
      .replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    if (!/^[A-Za-z0-9+/]+$/.test(encoded) || encoded.length % 4 === 1) {
      throw new Error('Invalid Gmail body encoding');
    }
    const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
    try {
      return Utilities.newBlob(Utilities.base64Decode(padded))
        .getDataAsString('UTF-8');
    } catch (e) {
      throw new Error('Gmail base64 decode failed');
    }
  }
  for (const child of part.parts || []) {
    const s = findPlain(child);
    if (s) return s;
  }
  return '';
}
