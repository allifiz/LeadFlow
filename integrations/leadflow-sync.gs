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
    try { publishFinderConfig_(props, token, OWNER); } catch(e) { console.warn('Finder config sync failed: '+String(e.message||e).slice(0,100)); }
    const cutoff = Date.now() - 30 * 86400000;
    for (const [key,value] of Object.entries(props.getProperties())) {
      if (key.startsWith('done_') && Number(value) < cutoff) props.deleteProperty(key);
    }
    let pageToken;
    let pages = 0;
    do {
      const result = Gmail.Users.Messages.list('me', {
        labelIds:['SENT'], q:'to:'+OWNER+' {subject:LEADFLOW_SYNC_V1 subject:LEADFLOW_SYNC_V2 subject:LEADFLOW_SYNC_V3} newer_than:14d',
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
          if (address(headers.from)!==OWNER || address(headers.to)!==OWNER || !/^LEADFLOW_SYNC_V[123] \d{4}-\d{2}-\d{2}$/.test(headers.subject||'')) continue;
          // Let Gmail handle MIME and transfer decoding instead of decoding Base64 ourselves.
          const plain = GmailApp.getMessageById(item.id).getPlainBody();
          const payload = JSON.parse(plain.trim());
          const version=Number(headers.subject.match(/^LEADFLOW_SYNC_V([123]) /)[1]);
          const finder=version>=2;
          if (payload.version!==version || !Array.isArray(payload.leads) || payload.leads.length>(version===3?5:20) || (finder && (typeof payload.campaign_id!=='string'||typeof payload.revision!=='string'||payload.date!==headers.subject.slice(-10))) || (version===3 && (typeof payload.batch_id!=='string'||!(/^[A-Za-z0-9_-]{16,100}$/).test(payload.batch_id)))) throw new Error('Invalid batch');
          // Never import claimed opt-in, status, secrets or other unexpected fields.
          const leads = payload.leads.map(l=>({name:l.name,phone:l.phone,email:l.email,category:l.category,location:l.location,source:l.source,priority:l.priority}));
          const headersOut = {Authorization:'Bearer '+token};
          const bypass = props.getProperty('LEADFLOW_VERCEL_BYPASS');
          if (bypass) headersOut['x-vercel-protection-bypass']=bypass;
          const response = UrlFetchApp.fetch(finder?LEADFLOW_ENDPOINT.replace('action=import','action=finder-import'):LEADFLOW_ENDPOINT,{
            method:'post',contentType:'application/json',headers:headersOut,
            payload:JSON.stringify(finder?{version,campaign_id:payload.campaign_id,revision:payload.revision,date:payload.date,...(version===3?{batch_id:payload.batch_id}:{}),leads}:{leads}),muteHttpExceptions:true,followRedirects:false
          });
          if (finder && response.getResponseCode()===409) { props.setProperty(key,String(Date.now())); console.warn('Finder V'+version+' batch rejected (409), campaign='+payload.campaign_id+' batch='+(payload.batch_id||'legacy')+' — refresh config; not imported.'); continue; }
          if (response.getResponseCode()!==200) throw new Error('LeadFlow HTTP '+response.getResponseCode());
          const r=JSON.parse(response.getContentText());
          if (finder && r.replayed===true) { props.setProperty(key,String(Date.now())); console.log('Finder: batch already imported'); continue; }
          if (!Number.isInteger(r.added)||!Number.isInteger(r.duplicates)||(finder?!Number.isInteger(r.invalid)||r.added+r.duplicates+r.invalid!==leads.length:!Array.isArray(r.errors)||r.added+r.duplicates+r.errors.length!==leads.length)) throw new Error('Unexpected response');
          props.setProperty(key,String(Date.now()));
          console.log('Batch imported: added='+r.added+' duplicates='+r.duplicates+' invalid='+(finder?r.invalid:r.errors.length)+(finder?' campaign='+payload.campaign_id:''));
          if(!finder&&r.errors.length) console.warn('Invalid rows: '+r.errors.map(x=>x.index).join(','));
        } catch(e) { console.warn('Batch not confirmed: '+String(e.message||e).slice(0,120)); }
      }
      pageToken=result.nextPageToken;
    } while(pageToken && ++pages<3);
    // Generate drafts only. No dispatch or consent changes.
    processDraftQueue_(props, token);
  } finally {lock.releaseLock();}
}

function processDraftQueue_(props,token) {
  const headers={Authorization:'Bearer '+token};
  const bypass=props.getProperty('LEADFLOW_VERCEL_BYPASS');
  if(bypass) headers['x-vercel-protection-bypass']=bypass;
  for(let i=0;i<3;i++){
    try {
      const r=UrlFetchApp.fetch(LEADFLOW_ENDPOINT.replace('action=import','action=draft-worker'),{
        method:'post',contentType:'application/json',headers,payload:'{}',muteHttpExceptions:true,followRedirects:false
      });
      if(r.getResponseCode()!==200){console.warn('Draft worker HTTP '+r.getResponseCode());break;}
      const result=JSON.parse(r.getContentText());
      console.log('Draft worker: '+result.state+(result.attempts?' (attempt '+result.attempts+')':''));
      if(result.state!=='ready')break;
    }catch(e){console.warn('Draft worker request failed');break;}
  }
}

function publishFinderConfig_(props,token,owner){
  const headers={Authorization:'Bearer '+token};
  const bypass=props.getProperty('LEADFLOW_VERCEL_BYPASS');
  if(bypass)headers['x-vercel-protection-bypass']=bypass;
  const r=UrlFetchApp.fetch(LEADFLOW_ENDPOINT.replace('action=import','action=finder-config&mode=batch'),{method:'get',headers,muteHttpExceptions:true,followRedirects:false});
  if(r.getResponseCode()!==200)throw new Error('Finder config HTTP '+r.getResponseCode());
  const config=JSON.parse(r.getContentText());
  if(config.version!==2||!/^\d{4}-\d{2}-\d{2}$/.test(config.date)||typeof config.revision!=='string'||!Array.isArray(config.campaigns))throw new Error('Invalid Finder config');
  const fingerprint=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(config)));
  if(props.getProperty('finder_config_hash')===fingerprint&&Date.now()-Number(props.getProperty('finder_config_sent_at')||0)<3600000)return;
  // Only self-email, no tokens or customer data. Refresh even when all campaigns paused.
  GmailApp.sendEmail(owner,'LEADFLOW_FINDER_CONFIG_V2 '+config.date,JSON.stringify({...config,published_at:new Date().toISOString()}));
  props.setProperty('finder_config_hash',fingerprint);
  props.setProperty('finder_config_sent_at',String(Date.now()));
  console.log('Finder config published: '+config.campaigns.length+' active campaign(s) awaiting results');
}
