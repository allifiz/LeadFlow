import {initProposalStudio} from './proposal-studio.js';
import {sourceOptions,sourcePlan} from './finder-sources.js';
import {customerView,jakartaDay,jakartaTime,eventFor,selectCustomers} from './customer-workspace.js';
const $=id=>document.getElementById(id);
let token='', leads=[], state={}, selected, page=1;
const pageSize=15;
let activeCustomerView='queue',queuePeriod='today',refreshSequence=0;
const todayJakarta=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const channelLabels={whatsapp:'WhatsApp',email:'Email',phone:'Telepon',manual:'Manual'};
const api=async(action,body)=>{
 const r=await fetch('/api/leadflow?action='+action,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const result=await r.json();if(!r.ok)throw Error(result.error||'Request gagal');return result;
};
const label={new:'Baru',sending:'Sedang mengirim',submitted:'Diajukan ke WhatsApp',unknown:'Perlu cek',manual:'Manual',blocked:'Jangan hubungi'};
const node=(tag,text,cls)=>{const x=document.createElement(tag);if(text!=null)x.textContent=text;if(cls)x.className=cls;return x};
const draftLabels={ready:'AI siap',pending:'Dalam antrean',generating:'Memproses',failed:'AI gagal',excluded:'Tidak dijadwalkan'};
const categoryKey=value=>String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('id-ID');
const categoryValue=lead=>categoryKey(lead.category)?'cat:'+categoryKey(lead.category):'uncategorized';
function updateCategories(){
 const select=$('categoryFilter'),previous=select.value,counts=new Map();
 for(const lead of leads.filter(x=>customerView(x)===activeCustomerView)){const key=categoryValue(lead);const current=counts.get(key);if(current)current.count++;else counts.set(key,{label:key==='uncategorized'?'Tanpa kategori':String(lead.category).trim().replace(/\s+/g,' ').replace(/^./u,x=>x.toLocaleUpperCase('id-ID')),count:1});}
 const all=node('option','Semua kategori');all.value='';
 const entries=[...counts.entries()].sort((a,b)=>a[0]==='uncategorized'?1:b[0]==='uncategorized'?-1:a[1].label.localeCompare(b[1].label,'id'));
 select.replaceChildren(all,...entries.map(([key,item])=>{const option=node('option',item.label+' ('+item.count+')');option.value=key;return option;}));
 select.value=counts.has(previous)?previous:'';
}
async function refresh(){const seq=++refreshSequence,auth=token;let next=await api('list&cursor=0'),all=[...next.leads];let cursor=next.next_cursor;while(cursor!==null&&cursor!==undefined){if(seq!==refreshSequence||auth!==token)return;const chunk=await api('list&cursor='+cursor);all.push(...chunk.leads);if(chunk.next_cursor!==null&&chunk.next_cursor<=cursor)throw Error('Pagination tidak valid');cursor=chunk.next_cursor;}if(seq!==refreshSequence||auth!==token)return;state={...next,leads:all};leads=all;updateCategories();updateCampaignFilters();$('total').textContent=leads.length;$('fresh').textContent=leads.filter(x=>x.status==='new').length;$('sent').textContent=leads.filter(x=>x.status==='submitted').length;$('unknown').textContent=leads.filter(x=>['unknown','sending'].includes(x.status)).length;$('automationState').textContent=state.hinaConfigured?'Gateway Hina dikonfigurasi · cek status di detail kontak':'Gateway Hina belum dikonfigurasi';$('pause').textContent=state.paused?'Aktifkan antrean':'Jeda antrean';$('pause').disabled=!state.configured&&state.paused;const counts={ready:0,pending:0,generating:0,failed:0};for(const l of leads){if(Object.hasOwn(counts,l.draft_state))counts[l.draft_state]++;}$('draftQueueSummary').textContent=!state.aiConfigured?'AI belum dikonfigurasi':Object.entries(counts).map(([k,v])=>draftLabels[k]+': '+v).join(' · ');$('draftRun').disabled=!state.aiConfigured;render();}
// Manual click-to-chat only. Opening WhatsApp never records consent or delivery.
function canOpenWa(l){return l?.status==='new'&&!l.blocked_at&&/^628\d{7,12}$/.test(l.phone||'');}
function waUrl(l,message){return 'https://wa.me/'+l.phone+'?text='+encodeURIComponent(message||'');}
function canSendDirect(l){return canOpenWa(l)&&state.hinaConfigured&&!!l.wa_verified&&!!l.opt_in_at&&!!String(l.opt_in_evidence||'').trim();}
async function sendDirect(l,message,button,notice){
 const text=String(message||'').trim();
 if(!canSendDirect(l)){notice.textContent='Perlu persetujuan penerima yang tercatat.';return;}
 if(!text||text.length>2000){notice.textContent='Pesan harus berisi 1-2000 karakter.';return;}
 if(!confirm('Kirim pesan berikut ke '+l.name+' melalui WhatsApp Hina? Human Takeover akan diaktifkan.\n\n'+text))return;
 button.disabled=true;notice.textContent='Mengirim melalui Hina...';
 let outcome;
 try{await api('send-hina',{id:l.id,message:text,confirmed:true});outcome='Pesan diajukan ke WhatsApp. Human takeover aktif; cek chat untuk status pengantaran.';}
 catch(e){outcome=e.message;}
 try{await refresh();}catch{}
 if($('details').open&&selected?.id===l.id){const latest=leads.find(x=>x.id===l.id);if(latest){selected=latest;$('sendDirect').hidden=!canSendDirect(latest);$('manual').disabled=latest.status!=='new';wa();showHinaStatus(latest);}}
 notice.textContent=outcome;
 button.disabled=false;
}
function canTakeover(l){return state.hinaConfigured&&/^628\d{7,12}$/.test(l?.phone||'');}
async function toggleTakeover(l,mode){
 return api('takeover',{id:l.id,mode});
}
async function showHinaStatus(l,mode='status'){
 const current=l.id;
 $('takeoverOn').disabled=true;$('takeoverOff').disabled=true;
 if(!canTakeover(l)){$('hinaStatus').textContent='Gateway belum dikonfigurasi atau nomor tidak valid.';return;}
 $('hinaStatus').textContent=mode==='on'?'Mengaktifkan Human Takeover...':mode==='off'?'Mengaktifkan balasan Hina...':'Memeriksa Hina...';
 try{
  const r=await toggleTakeover(l,mode);
  if(selected?.id!==current||!$('details').open)return;
  if(mode==='on'&&!r.takeover)throw Error('Human takeover belum aktif; coba OFF kembali.');
  $('hinaStatus').textContent=(r.takeover?'OFF · Kamu menangani chat':'ON · Hina membalas')+(r.connected?' · WhatsApp terhubung':' · WhatsApp belum terhubung');
  $('takeoverOn').disabled=r.takeover;$('takeoverOff').disabled=!r.takeover;
 }catch(e){if(selected?.id===current){$('hinaStatus').textContent=e.message;$('takeoverOn').disabled=false;$('takeoverOff').disabled=false;}}
}
async function openWithTakeover(event,l,message,notice){
 if(!state.hinaConfigured)return;
 event.preventDefault();
 const tab=window.open('about:blank','_blank');
 if(!tab){notice.textContent='Izinkan popup browser lalu coba lagi.';return;}
 tab.opener=null;
 try{
  const result=await toggleTakeover(l,'on');
  if(!result.takeover)throw Error('Human takeover belum aktif');
  if(!result.connected)throw Error('WhatsApp Hina tidak terhubung. Human takeover tetap aktif.');
  tab.location.replace(waUrl(l,message));
  notice.textContent='Human takeover aktif. Pesan belum terkirim; tekan Kirim di WhatsApp.';
 }catch(e){tab.close();notice.textContent=e.message;}
}
function updateCampaignFilters(){
 const select=$('campaignFilter'),previous=select.value,options=new Map();
 for(const l of leads.filter(x=>customerView(x)===activeCustomerView))options.set(l.campaign_id||'unknown',l.campaign_name||l.campaign_id||'Asal tidak tercatat');
 const all=node('option','Semua campaign');all.value='';
 select.replaceChildren(all,...[...options].sort((a,b)=>a[1].localeCompare(b[1],'id')).map(([id,name])=>{const o=node('option',name);o.value=id;return o;}));
 select.value=options.has(previous)?previous:'';
}
const proposalStudio=initProposalStudio({api,getLeads:()=>leads,isAuthenticated:()=>!!token});
const viewInfo={queue:['PROSPECT MANAGEMENT','Daftar calon customer','Antrean calon customer yang belum dihubungi.'],history:['CUSTOMER HISTORY','Histori customer','Customer yang telah ditandai dihubungi, diajukan ke WhatsApp, atau diblokir. Pengajuan bukan bukti pesan diterima.'],review:['DELIVERY REVIEW','Perlu cek','Pengiriman sedang berlangsung atau belum terkonfirmasi. Periksa percakapan sebelum mengambil tindakan.']};
function routeCustomer(){
 const hash=location.hash,view={'#customers':'queue','#customerHistory':'history','#customerReview':'review'}[hash];
 for(const child of document.querySelector('.dashboard').children){if(child.classList.contains('dashboard-footer'))continue;child.hidden=hash==='#proposalStudio'?child.id!=='proposalStudio':view?child.id!=='customers':['customers','proposalStudio'].includes(child.id);}
 for(const a of document.querySelectorAll('.nav-link')){if(a.getAttribute('href')===(hash||'#overview'))a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
 if(hash==='#proposalStudio'){proposalStudio.load();return;}
 if(!view)return;
 activeCustomerView=view;queuePeriod='today';page=1;
 $('search').value='';$('categoryFilter').value='';$('campaignFilter').value='';$('customerDate').value='';$('channelFilter').value='';$('draftFilter').value='';
 const all=node('option','Semua status');all.value='';
 const statuses=view==='queue'?['new']:view==='review'?['sending','unknown']:['submitted','manual','blocked'];
 $('filter').replaceChildren(all,...statuses.map(s=>{const o=node('option',label[s]);o.value=s;return o;}));
 $('filter').hidden=view==='queue';$('channelFilter').hidden=view==='queue';$('queuePeriods').hidden=view!=='queue';
 const info=viewInfo[view];$('customerKicker').textContent=info[0];$('customerTitle').textContent=info[1];$('customerDescription').textContent=info[2];$('customerEventHeader').textContent=view==='queue'?'Masuk (WIB)':'Aktivitas (WIB)';
 updateCategories();updateCampaignFilters();render();
}
function render(){
 const today=todayJakarta(),queue=leads.filter(x=>customerView(x)==='queue'),todayCount=queue.filter(x=>jakartaDay(x.created_at)===today).length;
 $('queueNavCount').textContent=queue.length;$('reviewNavCount').textContent=leads.filter(x=>customerView(x)==='review').length;
 $('queueToday').textContent=todayCount;$('queueOlder').textContent=queue.length-todayCount;$('queueAll').textContent=queue.length;
 for(const b of $('queuePeriods').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.period===queuePeriod));
 const visible=selectCustomers(leads,{view:activeCustomerView,period:activeCustomerView==='queue'?queuePeriod:'all',today,date:$('customerDate').value,campaign:$('campaignFilter').value,channel:activeCustomerView==='queue'?'':$('channelFilter').value,status:$('filter').value,draft:$('draftFilter').value,category:$('categoryFilter').value,search:$('search').value.trim(),categoryOf:categoryValue});
 const pages=Math.max(1,Math.ceil(visible.length/pageSize));page=Math.min(Math.max(page,1),pages);
 $('rows').replaceChildren();$('empty').hidden=visible.length>0;
 $('resultCount').textContent=visible.length+' customer';
 $('pageInfo').textContent=visible.length?((page-1)*pageSize+1)+'–'+Math.min(page*pageSize,visible.length)+' dari '+visible.length:'0 customer';
 $('prevPage').disabled=page===1;$('nextPage').disabled=page===pages;
 let lastGroup=null;
 for(const l of visible.slice((page-1)*pageSize,page*pageSize)){
  const event=eventFor(l,activeCustomerView),date=jakartaDay(event.at);
  const group=date+'|'+(activeCustomerView==='queue'?(l.batch_id||''):'');
  if(group!==lastGroup){
   const row=node('tr',null,'customer-group-row'),cell=node('td');cell.colSpan=6;
   cell.textContent=(date===today?'Hari ini · ':date?'':'')+(date||'Waktu tidak tercatat')+(activeCustomerView==='queue'?(l.batch_id?' · Batch '+l.batch_id.slice(0,8):' · Batch tidak tercatat'):'');
   row.append(cell);$('rows').append(row);lastGroup=group;
  }
  const tr=node('tr');const name=node('td');const identity=node('div',null,'identity');const avatar=node('span',String(l.name||'?').split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase(),'avatar');avatar.dataset.tone=String(Number(l.id)%4);
  const meta=node('div',null,'identity-text');meta.append(node('strong',l.name),node('small',[l.category,l.location].filter(Boolean).join(' · ')||'Tanpa kategori'));
  if(l.campaign_name||l.campaign_id)meta.append(node('small',l.campaign_name||l.campaign_id,'customer-campaign'));
  if(/^https?:\/\//i.test(l.source)){const a=node('a','Sumber ↗','source');a.href=l.source;a.target='_blank';a.rel='noopener noreferrer';meta.append(a);}
  identity.append(avatar,meta);name.append(identity);
  const contact=node('td',null,'contact-cell');contact.append(node('span',l.phone?'+'+l.phone:'—','phone'));if(l.email)contact.append(node('small',l.email,'email'));if(l.wa_verified)contact.append(node('small','WA terverifikasi','verified'));
  const st=node('td');st.append(node('span',label[l.status]||l.status,'pill '+l.status));if(l.opt_in_at)st.append(node('small','Opt-in tercatat','status-note'));
  const eventCell=node('td');eventCell.append(node('span',event.at?(date+' · '+jakartaTime(event.at)):'Tidak tercatat'));eventCell.append(node('small',event.label+(event.channel?' · '+(channelLabels[event.channel]||event.channel):''),'status-note'));
  const ai=node('td');ai.append(node('span',draftLabels[l.draft_state]||'Template','draft-pill '+(l.draft_state||'pending')));
  const actions=node('td',null,'row-actions');const wrap=node('div',null,'action-group');
  const b=node('button','Detail','detail-button');const attested=canOpenWa(l)&&!l.opt_in_at;b.onclick=()=>open(l,attested);if(attested)b.title='Buka setelah persetujuan WhatsApp benar-benar diterima dan nomor terverifikasi';wrap.append(b);
  if(canSendDirect(l)){const send=node('button','Kirim','primary');send.onclick=()=>sendDirect(l,l.draft,send,$('notice'));wrap.append(send);}
  else if(canOpenWa(l)){const send=node('a','Buka WA','button subtle');send.href=waUrl(l,l.draft);send.target='_blank';send.rel='noopener noreferrer';send.title='Buka WhatsApp untuk pengiriman manual setelah izin penerima diperiksa';send.onclick=e=>{if(state.hinaConfigured)openWithTakeover(e,l,l.draft,$('notice'));else $('notice').textContent='WhatsApp dibuka. Gateway Hina belum aktif; auto reply belum dinonaktifkan.';};wrap.append(send);}
  actions.append(wrap);tr.append(name,contact,st,eventCell,ai,actions);$('rows').append(tr);
 }
}
function parseImport(text){try{const parsed=JSON.parse(text);return Array.isArray(parsed)?parsed:parsed.leads;}catch{
 const clean=s=>s.replace(/\*\*/g,'').replace(/^\d+\.\s*/,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').trim();
 return text.split('\n').filter(x=>x.trim().startsWith('|')).map(x=>x.trim().replace(/^\||\|$/g,'').split('|').map(clean)).filter(x=>x.length>=3&&!/calon customer|list calon|^[-:\s]+$/.test(x[0].toLowerCase())).map((x,i)=>({name:x[0],phone:x[1].replace(/\s*\(.+\)$/,''),email:(x[2].match(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i)||[])[0]||'',priority:Math.max(0,100-i)}));
 }}
$('loginForm').onsubmit=async e=>{e.preventDefault();token=$('token').value;try{await refresh();$('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('token').value='';routeCustomer();loadFinder();}catch(e){token='';$('loginError').textContent=e.message;}};
$('logout').onclick=()=>{refreshSequence++;token='';proposalStudio.reset();leads=[];state={};selected=null;page=1;finderState=null;$('finderCards').replaceChildren();$('finderHistory').replaceChildren();if($('finderEditor').open)$('finderEditor').close();updateCategories();$('rows').replaceChildren();$('workspace').hidden=true;$('login').hidden=false;$('logout').hidden=true;$('loginError').textContent='';};
const resetFilters=()=>{page=1;render();};$('search').oninput=resetFilters;$('filter').onchange=resetFilters;$('draftFilter').onchange=resetFilters;$('categoryFilter').onchange=resetFilters;$('prevPage').onclick=()=>{page--;render();};$('nextPage').onclick=()=>{page++;render();};$('clearFilters').onclick=()=>{$('search').value='';$('filter').value='';$('draftFilter').value='';$('categoryFilter').value='';$('campaignFilter').value='';$('channelFilter').value='';$('customerDate').value='';resetFilters();};
for(const id of ['campaignFilter','channelFilter','customerDate'])$(id).onchange=()=>{if(id==='customerDate'&&$('customerDate').value&&activeCustomerView==='queue')queuePeriod='all';resetFilters();};
for(const b of $('queuePeriods').querySelectorAll('button'))b.onclick=()=>{queuePeriod=b.dataset.period;$('customerDate').value='';resetFilters();};
window.addEventListener('hashchange',()=>{if(token)routeCustomer();});
$('customerReload').onclick=()=>refresh().catch(e=>$('notice').textContent=e.message);
let autoRefreshing=false;
setInterval(async()=>{if(!token||document.hidden||$('details').open||$('finderEditor').open||autoRefreshing)return;autoRefreshing=true;try{await refresh();await loadFinder();}catch{}finally{autoRefreshing=false;}},60000);
$('reload').onclick=()=>{refresh().catch(e=>$('notice').textContent=e.message);loadFinder();};
$('draftRun').onclick=async()=>{const b=$('draftRun');b.disabled=true;b.textContent='Memproses...';try{const r=await api('draft-worker',{});await refresh();$('notice').textContent='Draft worker: '+r.state;}catch(e){$('notice').textContent=e.message;}finally{b.disabled=!state.aiConfigured;b.textContent='Proses satu draft';}};
$('pause').onclick=async()=>{if(state.paused&&!confirm('Aktifkan pengiriman pertama otomatis hanya ke kontak dengan opt-in?'))return;try{await api('pause',{paused:!state.paused});await refresh();}catch(e){$('notice').textContent=e.message;}};
$('import').onclick=async()=>{try{const rows=parseImport($('importData').value);if(!Array.isArray(rows)||!rows.length)throw Error('Data kosong / format tidak valid');const r=await api('import',{leads:rows});$('importResult').textContent='Ditambah '+r.added+' · Duplikat '+r.duplicates+' · Invalid '+r.errors.length;await refresh();}catch(e){$('importResult').textContent=e.message;}};
function open(l,attested=false){selected=l;$('detailName').textContent=l.name;$('detailInfo').textContent=[l.phone,l.email,label[l.status],l.last_error].filter(Boolean).join(' · ');$('message').value=l.draft;const event=eventFor(l,customerView(l));$('detailMetadata').textContent=[l.created_at?'Masuk '+jakartaDay(l.created_at)+' '+jakartaTime(l.created_at)+' WIB':'',l.campaign_name||l.campaign_id||'Asal campaign tidak tercatat',l.batch_id?'Batch '+l.batch_id:'',l.status!=='new'?(event.at?event.label+' '+jakartaDay(event.at)+' '+jakartaTime(event.at)+' WIB':event.label+' · waktu tidak tercatat'):''].filter(Boolean).join(' · ');$('manualChannel').value='manual';$('manualChannel').disabled=l.status!=='new';const existing=!!l.wa_verified&&!!l.opt_in_at&&!!String(l.opt_in_evidence||'').trim();
 const prefill=attested===true&&canOpenWa(l)&&!l.opt_in_at;
 const date=new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',day:'numeric',month:'long',year:'numeric'}).format(new Date());
 $('evidence').value=l.opt_in_evidence||(prefill?date+' (tanggal pencatatan). Operator mengonfirmasi nomor WA telah diverifikasi dan kontak telah memberikan persetujuan menerima penawaran website melalui WhatsApp. Metode/bukti: ':'');
 $('confirmed').checked=existing||prefill;$('detailNotice').textContent=l.draft_engine==='AI'?'Draft AI tersimpan: '+(l.draft_model||''):(draftLabels[l.draft_state]||'Draft awal: template lokal')+(l.draft_error?' · '+l.draft_error:'');$('consent').disabled=l.status!=='new';$('manual').disabled=l.status!=='new';$('generate').textContent='Generate draft';$('generate').disabled=l.status==='blocked';$('copy').disabled=l.status==='blocked';$('sendDirect').hidden=!canSendDirect(l);$('sendDirect').disabled=false;wa();$('details').showModal();$('detailBody').scrollTop=0;showHinaStatus(l,l.status==='new'?'on':'status');}
function wa(){const available=canOpenWa(selected);$('waLink').hidden=!available;if(available){$('waLink').href=waUrl(selected,$('message').value);$('waLink').title='Buka draft di WhatsApp; belum dikirim';}}
$('message').oninput=wa;
$('sendDirect').onclick=()=>sendDirect(selected,$('message').value,$('sendDirect'),$('detailNotice'));
$('waLink').onclick=e=>{if(state.hinaConfigured){openWithTakeover(e,selected,$('message').value,$('detailNotice'));}else{$('detailNotice').textContent='WhatsApp dibuka. Gateway Hina belum aktif; auto reply belum dinonaktifkan.';}};
$('takeoverOn').onclick=()=>showHinaStatus(selected,'on');
$('takeoverOff').onclick=()=>{if(confirm('Aktifkan kembali balasan otomatis Hina untuk kontak ini?'))showHinaStatus(selected,'off');};
$('generate').onclick=async()=>{
 const id=selected.id, previous=$('message').value;
 $('generate').disabled=true;$('generate').textContent='Generating...';$('detailNotice').textContent='Menghubungi 9Router...';
 try{
  const r=await api('draft',{id,previous});
  const l=leads.find(x=>x.id===id);
  if(l)Object.assign(l,{draft:r.draft,draft_engine:r.engine,draft_model:r.model,draft_state:'ready',draft_error:null});
  if(selected?.id===id&&$('details').open){$('message').value=r.draft;wa();$('detailNotice').textContent='Draft AI tersimpan: '+r.model;}
 }catch(e){if(selected?.id===id&&$('details').open)$('detailNotice').textContent=e.message;}
 finally{if(selected?.id===id){$('generate').disabled=selected.status==='blocked';$('generate').textContent='Generate draft';}}
};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('message').value);$('detailNotice').textContent='Draft disalin. Periksa izin penerima sebelum menghubungi.';}catch{$('detailNotice').textContent='Clipboard tidak tersedia; pilih teks secara manual.';}};
async function change(action,data){try{await api(action,{id:selected.id,...data});await refresh();$('details').close();}catch(e){$('detailNotice').textContent=e.message;}}
$('consent').onclick=async()=>{
 const id=selected.id,button=$('consent'),evidence=$('evidence').value.trim();
 if(!evidence||!$('confirmed').checked){$('detailNotice').textContent='Lengkapi bukti persetujuan dan konfirmasi terlebih dahulu.';return;}
 if(evidence.endsWith('Metode/bukti:')){$('detailNotice').textContent='Isi metode atau bukti persetujuan yang benar-benar diterima.';$('evidence').focus();return;}
 button.disabled=true;
 try{await api('consent',{id,evidence,confirmed:true});await refresh();if(selected?.id===id&&$('details').open){selected=leads.find(x=>x.id===id)||selected;$('sendDirect').hidden=!canSendDirect(selected);$('detailNotice').textContent='Persetujuan tersimpan. Draft siap ditinjau dan dikirim secara manual.';}}
 catch(e){if(selected?.id===id)$('detailNotice').textContent=e.message;}
 finally{if(selected?.id===id)button.disabled=selected.status!=='new';}
};
$('manual').onclick=()=>{if(confirm('Tandai sudah dihubungi secara manual?'))change('manual',{channel:$('manualChannel').value});};
$('block').onclick=()=>{if(confirm('Blokir seluruh penawaran selanjutnya untuk lead ini?'))change('block',{});};

let finderState=null,editingCampaign=null;
const choicePresets={
 fCategories:['Sekolah','Pendidikan','Bimbingan belajar','Klinik','Klinik gigi','Kesehatan','Wedding','Event organizer','Restoran','Kafe','Hotel','Travel','Rental mobil','Properti','Kontraktor','Arsitektur','Retail','UMKM','Jasa profesional','Bengkel'],
 fServices:['Landing page','Company profile','Website sekolah','Website katalog','Website toko online','Website booking','Redesign website','Maintenance website'],
 fSources:sourceOptions,
 fWebsite:[['any','Semua kondisi'],['no_website','Belum punya website'],['needs_improvement','Perlu peningkatan'],['no_or_weak','Belum punya / perlu peningkatan']],
 fContact:[['either','WA atau email'],['whatsapp','WhatsApp'],['email','Email'],['both','WA dan email']],
 fInstruction:[['','Tanpa preferensi khusus'],['Prioritaskan bisnis lokal dan calon pelanggan yang relevan.','Bisnis lokal'],['Prioritaskan bisnis independen dan UMKM lokal.','UMKM independen'],['Prioritaskan bisnis aktif dengan kontak publik yang mudah diverifikasi.','Kontak mudah diverifikasi'],['Prioritaskan bisnis dengan kebutuhan website yang paling jelas dan relevan.','Kebutuhan website tinggi'],['Prioritaskan sekolah swasta dan lembaga pendidikan lokal.','Sekolah swasta & lembaga pendidikan']]
};
const regionMemo=new Map();
let regionEdit=null,regionSeq=0,finderSaving=false;
const normScope=v=>String(v||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('id-ID');
function drawChoices(id,selected,multi,extras=[]){
 const picked=multi?(Array.isArray(selected)?selected:[]):[selected??''];
 let options=choicePresets[id].map(x=>Array.isArray(x)?x:[x,x]);
 const seen=new Set(options.map(x=>normScope(x[0])));
 for(const item of [...picked,...extras]){
  if(item&& !seen.has(normScope(item))){options.push([item,item]);seen.add(normScope(item));}
 }
 const host=$(id);host.replaceChildren();
 for(const [value,text] of options){
  const label=node('label',null,'choice-option'),input=node('input');input.type=multi?'checkbox':'radio';input.name=id;input.value=value;input.checked=picked.some(x=>normScope(x)===normScope(value));label.append(input,node('span',text));host.append(label);
 }
}
function updateSourcePriority(value=$('fSourcePriority').value){
 const select=$('fSourcePriority'),auto=node('option','Otomatis sesuai industri');auto.value='';
 select.replaceChildren(auto,...sourcePlan({sources:readChoices('fSources',true)}).map(s=>{const o=node('option',s);o.value=s;return o;}));
 select.value=Array.from(select.options).some(o=>o.value===value)?value:'';
}
$('fSources').addEventListener('change',()=>updateSourcePriority());
function readChoices(id,multi=false){
 const values=Array.from($(id).querySelectorAll('input:checked')).map(x=>x.value);
 return multi?values:(values[0]??'');
}
async function getRegions(level,parent=''){
 const key=level+':'+parent;if(regionMemo.has(key))return regionMemo.get(key);
 const result=await api('finder-regions&level='+encodeURIComponent(level)+(parent?'&parent='+encodeURIComponent(parent):''));
 if(!Array.isArray(result.data)||!result.data.length)throw Error('Daftar wilayah kosong');
 regionMemo.set(key,result.data);return result.data;
}
function regionOptions(id,rows,placeholder,all=false){
 const select=$(id),first=node('option',placeholder);first.value=all?'all':'';
 select.replaceChildren(first,...rows.map(x=>{const option=node('option',x.name);option.value=x.code;return option;}));select.value=first.value;
}
function choiceName(id){const select=$(id);return select.options[select.selectedIndex]?.text||'';}
function regionMessage(text='',error=false){$('fRegionNotice').textContent=text;$('fRegionRetry').hidden=!error;}
function updateRegionReady(){
 const ready=regionEdit&&(!regionEdit.dirty&&regionEdit.original||!regionEdit.loading&&$('fProvince').value&&$('fRegency').value&&$('fDistrict').value);
 $('finderSave').disabled=!ready||finderSaving;
 $('fRegionType').disabled=!!regionEdit?.loading;
 $('fRegency').disabled=!!regionEdit?.loading;
 $('fDistrict').disabled=!!regionEdit?.loading;
}
function resetDistrict(){ $('fDistrictFields').hidden=true;regionOptions('fDistrict',[],'Semua kecamatan',true); }
function displayRegencies(){
 const type=$('fRegionType').value;const list=(regionEdit?.regencies||[]).filter(x=>type==='all'||(type==='city'?/^kota\b/i.test(x.name):/^kabupaten\b/i.test(x.name)));
 regionOptions('fRegency',list,'Pilih kabupaten / kota');resetDistrict();
}
async function loadDistrict(regency,desired=''){
 const edit=regionEdit,seq=++regionSeq;resetDistrict();if(!regency){edit.loading=false;updateRegionReady();return;}
 edit.loading=true;updateRegionReady();regionMessage('Memuat kecamatan…');
 try{
  const rows=await getRegions('districts',regency);if(regionEdit!==edit||seq!==regionSeq)return;
  regionOptions('fDistrict',rows,'Semua kecamatan',true);
  if(desired&&rows.some(x=>x.code===desired))$('fDistrict').value=desired;
  $('fDistrictFields').hidden=false;regionMessage();
 }catch(e){if(regionEdit===edit&&seq===regionSeq){regionMessage(e.message,true);$('fDistrict').value='';}}
 finally{if(regionEdit===edit&&seq===regionSeq){edit.loading=false;updateRegionReady();}}
}
async function loadRegencies(province,desiredName='',desiredDistrict=''){
 const edit=regionEdit,seq=++regionSeq;edit.regencies=[];displayRegencies();$('fRegencyFields').hidden=!province;
 if(!province){edit.loading=false;updateRegionReady();return;}
 edit.loading=true;updateRegionReady();regionMessage('Memuat kabupaten / kota…');
 try{
  const rows=await getRegions('regencies',province);if(regionEdit!==edit||seq!==regionSeq)return;
  edit.regencies=rows;displayRegencies();regionMessage();
  const match=rows.find(x=>normScope(x.name)===normScope(desiredName));
  if(match){$('fRegency').value=match.code;const nextSeq=regionSeq+1;await loadDistrict(match.code);if(regionEdit===edit&&regionSeq===nextSeq&&desiredDistrict){const options=Array.from($('fDistrict').options);const district=options.find(x=>normScope(x.text)===normScope(desiredDistrict));if(district)$('fDistrict').value=district.value;}}
 }catch(e){if(regionEdit===edit&&seq===regionSeq)regionMessage(e.message,true);}
 finally{if(regionEdit===edit&&seq===regionSeq){edit.loading=false;updateRegionReady();}}
}
async function initRegions(c){
 const edit={original:c?{regions:c.regions||[],districts:c.districts||[]}:null,dirty:!c,loading:true,regencies:[]};regionEdit=edit;const seq=++regionSeq;
 $('fSavedRegion').hidden=!c;$('fSavedRegionText').textContent=c?[c.regions.join(' · '),c.districts.length?c.districts.join(' · '):'Semua kecamatan'].join(' / '):'';
 $('fRegionType').value='all';regionOptions('fProvince',[],'Pilih provinsi');$('fRegencyFields').hidden=true;resetDistrict();regionMessage('Memuat provinsi…');updateRegionReady();
 try{
  const provinces=await getRegions('provinces');if(regionEdit!==edit||seq!==regionSeq)return;
  regionOptions('fProvince',provinces,'Pilih provinsi');regionMessage();
  if(c?.regions?.length===1){
   const parts=c.regions[0].split(',').map(x=>x.trim());const province=provinces.find(x=>normScope(x.name)===normScope(parts.at(-1)));
   if(province){$('fProvince').value=province.code;await loadRegencies(province.code,parts[0],c.districts.length===1?c.districts[0]:'');}
  }
 }catch(e){if(regionEdit===edit&&seq===regionSeq)regionMessage(e.message,true);}
 finally{if(regionEdit===edit&&seq===regionSeq){edit.loading=false;updateRegionReady();}}
}
function markRegion(){if(regionEdit){regionEdit.dirty=true;updateRegionReady();}}
$('fProvince').onchange=()=>{markRegion();$('fRegionType').value='all';loadRegencies($('fProvince').value);};
$('fRegionType').onchange=()=>{regionSeq++;markRegion();if(regionEdit)regionEdit.loading=false;displayRegencies();regionMessage();updateRegionReady();};
$('fRegency').onchange=()=>{markRegion();loadDistrict($('fRegency').value);};
$('fDistrict').onchange=markRegion;
$('fKeepRegion').onclick=()=>{if(regionEdit?.original){regionEdit.dirty=false;regionMessage('Wilayah tersimpan akan tetap digunakan kecuali pilihan diubah.');updateRegionReady();}};
$('fRegionRetry').onclick=()=>{const province=$('fProvince').value,regency=$('fRegency').value;if(regency)loadDistrict(regency);else if(province)loadRegencies(province);else initRegions(finderState?.campaigns.find(c=>c.id===editingCampaign));};
function selectedScope(){
 if(regionEdit?.original&&!regionEdit.dirty)return regionEdit.original;
 if(!regionEdit||regionEdit.loading||!$('fProvince').value||!$('fRegency').value||!$('fDistrict').value)throw Error('Pilih provinsi, kabupaten/kota, dan kecamatan terlebih dahulu.');
 return {regions:[choiceName('fRegency')+', '+choiceName('fProvince')],districts:$('fDistrict').value==='all'?[]:[choiceName('fDistrict')]};
}
function renderFinder(){
 if(!finderState)return;
 const active=finderState.campaigns.filter(x=>x.enabled);
 $('finderCount').textContent=active.length+' aktif';
 $('finderBudget').textContent='Target aktif: '+active.reduce((n,x)=>n+x.daily_limit,0)+' / 40 lead per hari';
 $('finderBatchSize').value=String(finderState.batch_size??10);$('finderBatchSize').disabled=false;
 $('finderCards').replaceChildren();
 for(const c of finderState.campaigns){
  const card=node('article',null,'campaign-card'),head=node('div',null,'campaign-head');
  head.append(node('h3',c.name),node('span',c.enabled?'Aktif':'Pause','pill '+(c.enabled?'submitted':'')));
  const target=node('div',null,'campaign-target');target.append(node('strong',String(c.daily_limit)),node('small','lead / hari'));
  const progress=(finderState.progress||[]).find(r=>r.campaign_id===c.id)||{};
  const added=Number(progress.added||0),remaining=Math.max(0,c.daily_limit-added);
  const meter=node('progress');meter.max=c.daily_limit;meter.value=Math.min(added,c.daily_limit);meter.setAttribute('aria-label','Progress '+c.name);meter.className='finder-progress';
  const progressText=node('p',added+' / '+c.daily_limit+' lead baru · '+remaining+' tersisa · '+Number(progress.batches||0)+' batch V3','campaign-meta');
  const tags=node('div',null,'campaign-tags');for(const cat of c.categories.length?c.categories:['Semua kategori'])tags.append(node('span',cat,'count-tag'));
  const actions=node('div',null,'actions'),edit=node('button','Edit campaign'),toggle=node('button',c.enabled?'Pause':'Aktifkan');
  edit.onclick=()=>openFinderEditor(c);toggle.onclick=async()=>{toggle.disabled=true;try{await persistCampaign({...c,enabled:!c.enabled});}catch(e){$('finderNotice').textContent=e.message;}finally{toggle.disabled=false;}};
  actions.append(edit,toggle);
  card.append(head,node('p',c.regions.join(' · '),'campaign-meta'),target,meter,progressText,tags,node('p','Sumber prioritas: '+sourcePlan(c).slice(0,3).join(' · '),'campaign-meta'),node('p',c.districts.length?c.districts.join(' · '):'Semua kecamatan','campaign-meta'),actions);$('finderCards').append(card);
 }
 $('finderSourceStats').replaceChildren();
 const stats=finderState.source_stats||[];$('finderSourceEmpty').hidden=stats.length>0;
 for(const r of stats){const tr=node('tr');tr.append(node('td',finderState.campaigns.find(c=>c.id===r.campaign_id)?.name||r.campaign_id),node('td',r.source),node('td',String(r.added)));$('finderSourceStats').append(tr);}
 $('finderHistory').replaceChildren();
 const history=finderState.history||[];$('finderHistoryCount').textContent=history.length;$('finderHistoryEmpty').hidden=history.length>0;
 for(const r of history){const tr=node('tr');for(const key of ['day','campaign_name','target','found','added','duplicates','invalid','batches'])tr.append(node('td',String(r[key]??'—')));$('finderHistory').append(tr);}
}
async function loadFinder(){
 try{const next=await api('finder-studio');if(!token)return;finderState=next;renderFinder();$('finderNotice').textContent='';}
 catch(e){$('finderNotice').textContent=e.message;}
}
$('finderBatchSize').onchange=async()=>{
 if(!finderState)return;
 const input=$('finderBatchSize'),size=Number(input.value);input.disabled=true;
 try{const result=await api('finder-batch-size',{revision:finderState.revision,batch_size:size});
 finderState={...finderState,...result};renderFinder();$('finderNotice').textContent='Ukuran batch tersimpan. Berlaku setelah sinkronisasi Gmail; GAS terbaru diperlukan untuk 10 lead.';}
 catch(e){input.value=String(finderState.batch_size??10);$('finderNotice').textContent=e.message;}
 finally{input.disabled=false;}
};
async function persistCampaign(c){
 if(!finderState)throw Error('Finder Studio belum dimuat');
 const result=await api('finder-save',{revision:finderState.revision,campaign:c});
 finderState={...finderState,...result};renderFinder();$('finderNotice').textContent='Campaign tersimpan. Sinkronisasi Gmail mengikuti trigger Apps Script.';
}
function openFinderEditor(c){
 if(!finderState){$('finderNotice').textContent='Segarkan Finder Studio dulu.';return;}
 editingCampaign=c?.id||null;
 $('finderEditorTitle').textContent=c?'Edit campaign':'Campaign baru';
 $('fName').value=c?.name||'';$('fEnabled').checked=c?.enabled??false;
 drawChoices('fCategories',c?.categories||[],true,[...new Set(leads.map(x=>x.category).filter(Boolean))]);
 drawChoices('fServices',c?.services||['Landing page','Company profile'],true);
 drawChoices('fSources',c?.sources||['Website publik','Direktori bisnis'],true);
 updateSourcePriority(c?.preferred_source||'');
 drawChoices('fWebsite',c?.website_status||'any',false);
 drawChoices('fContact',c?.contact||'either',false);
 drawChoices('fInstruction',c?.instruction||'',false);
 $('fLimit').value=c?.daily_limit??10;$('fPriority').value=c?.minimum_priority??50;
 $('finderEditorNotice').textContent='';$('finderEditor').showModal();$('finderEditor').querySelector('.drawer-body').scrollTop=0;initRegions(c);
}
$('finderReload').onclick=loadFinder;$('finderNew').onclick=()=>openFinderEditor(null);
$('finderForm').onsubmit=async e=>{
 e.preventDefault();if(finderSaving)return;finderSaving=true;$('finderSave').disabled=true;
 try{
  const c={...(editingCampaign?{id:editingCampaign}:{}),name:$('fName').value,enabled:$('fEnabled').checked,daily_limit:Number($('fLimit').value),minimum_priority:Number($('fPriority').value),website_status:readChoices('fWebsite'),contact:readChoices('fContact'),instruction:readChoices('fInstruction'),categories:readChoices('fCategories',true),services:readChoices('fServices',true),sources:readChoices('fSources',true),preferred_source:$('fSourcePriority').value,excluded_categories:finderState.campaigns.find(x=>x.id===editingCampaign)?.excluded_categories||[],...selectedScope()};
  if(!c.services.length)throw Error('Pilih minimal satu jenis jasa.');
  if(c.categories.length>20)throw Error('Pilih maksimal 20 kategori bisnis.');
  await persistCampaign(c);$('finderEditor').close();
 }catch(e){$('finderEditorNotice').textContent=e.message;}finally{finderSaving=false;updateRegionReady();}
};
