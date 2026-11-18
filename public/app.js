const $=id=>document.getElementById(id);
let token='', leads=[], state={}, selected, page=1;
const pageSize=15;
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
 for(const lead of leads){const key=categoryValue(lead);const current=counts.get(key);if(current)current.count++;else counts.set(key,{label:key==='uncategorized'?'Tanpa kategori':String(lead.category).trim().replace(/\s+/g,' ').replace(/^./u,x=>x.toLocaleUpperCase('id-ID')),count:1});}
 const all=node('option','Semua kategori');all.value='';
 const entries=[...counts.entries()].sort((a,b)=>a[0]==='uncategorized'?1:b[0]==='uncategorized'?-1:a[1].label.localeCompare(b[1].label,'id'));
 select.replaceChildren(all,...entries.map(([key,item])=>{const option=node('option',item.label+' ('+item.count+')');option.value=key;return option;}));
 select.value=counts.has(previous)?previous:'';
}
async function refresh(){state=await api('list');leads=state.leads;updateCategories();$('total').textContent=leads.length;$('fresh').textContent=leads.filter(x=>x.status==='new').length;$('sent').textContent=leads.filter(x=>x.status==='submitted').length;$('unknown').textContent=leads.filter(x=>['unknown','sending'].includes(x.status)).length;$('automationState').textContent=state.hinaConfigured?'Gateway Hina dikonfigurasi · cek status di detail kontak':'Gateway Hina belum dikonfigurasi';$('pause').textContent=state.paused?'Aktifkan antrean':'Jeda antrean';$('pause').disabled=!state.configured&&state.paused;const counts={ready:0,pending:0,generating:0,failed:0};for(const l of leads){if(Object.hasOwn(counts,l.draft_state))counts[l.draft_state]++;}$('draftQueueSummary').textContent=!state.aiConfigured?'AI belum dikonfigurasi':Object.entries(counts).map(([k,v])=>draftLabels[k]+': '+v).join(' · ');$('draftRun').disabled=!state.aiConfigured;render();}
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
function render(){
 const search=$('search').value.trim().toLowerCase(),status=$('filter').value,draftFilter=$('draftFilter').value,categoryFilter=$('categoryFilter').value;
 const visible=leads.filter(x=>(!status||x.status===status)&&(!draftFilter||x.draft_state===draftFilter)&&(!categoryFilter||categoryValue(x)===categoryFilter)&&[x.name,x.phone,x.email,x.category,x.location].join(' ').toLowerCase().includes(search));
 const pages=Math.max(1,Math.ceil(visible.length/pageSize));page=Math.min(Math.max(page,1),pages);
 $('rows').replaceChildren();$('empty').hidden=visible.length>0;
 $('resultCount').textContent=visible.length+' customer';
 $('pageInfo').textContent=visible.length?((page-1)*pageSize+1)+'–'+Math.min(page*pageSize,visible.length)+' dari '+visible.length:'0 customer';
 $('prevPage').disabled=page===1;$('nextPage').disabled=page===pages;
 for(const l of visible.slice((page-1)*pageSize,page*pageSize)){
  const tr=node('tr');const name=node('td');const identity=node('div',null,'identity');const avatar=node('span',String(l.name||'?').split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase(),'avatar');avatar.dataset.tone=String(Number(l.id)%4);
  const meta=node('div',null,'identity-text');meta.append(node('strong',l.name),node('small',[l.category,l.location].filter(Boolean).join(' · ')||'Tanpa kategori'));
  if(/^https?:\/\//i.test(l.source)){const a=node('a','Sumber ↗','source');a.href=l.source;a.target='_blank';a.rel='noopener noreferrer';meta.append(a);}
  identity.append(avatar,meta);name.append(identity);
  const contact=node('td',null,'contact-cell');contact.append(node('span',l.phone?'+'+l.phone:'—','phone'));if(l.email)contact.append(node('small',l.email,'email'));if(l.wa_verified)contact.append(node('small','WA terverifikasi','verified'));
  const st=node('td');st.append(node('span',label[l.status]||l.status,'pill '+l.status));if(l.opt_in_at)st.append(node('small','Opt-in tercatat','status-note'));
  const ai=node('td');ai.append(node('span',draftLabels[l.draft_state]||'Template','draft-pill '+(l.draft_state||'pending')));
  const actions=node('td',null,'row-actions');const wrap=node('div',null,'action-group');
  const b=node('button','Detail','detail-button');const attested=canOpenWa(l)&&!l.opt_in_at;b.onclick=()=>open(l,attested);if(attested)b.title='Buka setelah persetujuan WhatsApp benar-benar diterima dan nomor terverifikasi';wrap.append(b);
  if(canSendDirect(l)){const send=node('button','Kirim','primary');send.onclick=()=>sendDirect(l,l.draft,send,$('notice'));wrap.append(send);}
  else if(canOpenWa(l)){const send=node('a','Buka WA','button subtle');send.href=waUrl(l,l.draft);send.target='_blank';send.rel='noopener noreferrer';send.title='Buka WhatsApp untuk pengiriman manual setelah izin penerima diperiksa';send.onclick=e=>{if(state.hinaConfigured)openWithTakeover(e,l,l.draft,$('notice'));else $('notice').textContent='WhatsApp dibuka. Gateway Hina belum aktif; auto reply belum dinonaktifkan.';};wrap.append(send);}
  actions.append(wrap);tr.append(name,contact,st,ai,actions);$('rows').append(tr);
 }
}
function parseImport(text){try{const parsed=JSON.parse(text);return Array.isArray(parsed)?parsed:parsed.leads;}catch{
 const clean=s=>s.replace(/\*\*/g,'').replace(/^\d+\.\s*/,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').trim();
 return text.split('\n').filter(x=>x.trim().startsWith('|')).map(x=>x.trim().replace(/^\||\|$/g,'').split('|').map(clean)).filter(x=>x.length>=3&&!/calon customer|list calon|^[-:\s]+$/.test(x[0].toLowerCase())).map((x,i)=>({name:x[0],phone:x[1].replace(/\s*\(.+\)$/,''),email:(x[2].match(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i)||[])[0]||'',priority:Math.max(0,100-i)}));
 }}
$('loginForm').onsubmit=async e=>{e.preventDefault();token=$('token').value;try{await refresh();$('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('token').value='';}catch(e){token='';$('loginError').textContent=e.message;}};
$('logout').onclick=()=>{token='';leads=[];state={};selected=null;page=1;updateCategories();$('rows').replaceChildren();$('workspace').hidden=true;$('login').hidden=false;$('logout').hidden=true;$('loginError').textContent='';};
const resetFilters=()=>{page=1;render();};$('search').oninput=resetFilters;$('filter').onchange=resetFilters;$('draftFilter').onchange=resetFilters;$('categoryFilter').onchange=resetFilters;$('prevPage').onclick=()=>{page--;render();};$('nextPage').onclick=()=>{page++;render();};$('clearFilters').onclick=()=>{$('search').value='';$('filter').value='';$('draftFilter').value='';$('categoryFilter').value='';resetFilters();};
$('reload').onclick=()=>refresh().catch(e=>$('notice').textContent=e.message);
$('draftRun').onclick=async()=>{const b=$('draftRun');b.disabled=true;b.textContent='Memproses...';try{const r=await api('draft-worker',{});await refresh();$('notice').textContent='Draft worker: '+r.state;}catch(e){$('notice').textContent=e.message;}finally{b.disabled=!state.aiConfigured;b.textContent='Proses satu draft';}};
$('pause').onclick=async()=>{if(state.paused&&!confirm('Aktifkan pengiriman pertama otomatis hanya ke kontak dengan opt-in?'))return;try{await api('pause',{paused:!state.paused});await refresh();}catch(e){$('notice').textContent=e.message;}};
$('import').onclick=async()=>{try{const rows=parseImport($('importData').value);if(!Array.isArray(rows)||!rows.length)throw Error('Data kosong / format tidak valid');const r=await api('import',{leads:rows});$('importResult').textContent='Ditambah '+r.added+' · Duplikat '+r.duplicates+' · Invalid '+r.errors.length;await refresh();}catch(e){$('importResult').textContent=e.message;}};
function open(l,attested=false){selected=l;$('detailName').textContent=l.name;$('detailInfo').textContent=[l.phone,l.email,label[l.status],l.last_error].filter(Boolean).join(' · ');$('message').value=l.draft;const existing=!!l.wa_verified&&!!l.opt_in_at&&!!String(l.opt_in_evidence||'').trim();
 const prefill=attested===true&&canOpenWa(l)&&!l.opt_in_at;
 const date=new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',day:'numeric',month:'long',year:'numeric'}).format(new Date());
 $('evidence').value=l.opt_in_evidence||(prefill?date+' (tanggal pencatatan). Operator mengonfirmasi nomor WA telah diverifikasi dan kontak telah memberikan persetujuan menerima penawaran website melalui WhatsApp. Metode/bukti: ':'');
 $('confirmed').checked=existing||prefill;$('detailNotice').textContent=l.draft_engine==='AI'?'Draft AI tersimpan: '+(l.draft_model||''):(draftLabels[l.draft_state]||'Draft awal: template lokal')+(l.draft_error?' · '+l.draft_error:'');$('consent').disabled=l.status!=='new';$('manual').disabled=l.status!=='new';$('generate').textContent='Generate draft';$('generate').disabled=l.status==='blocked';$('copy').disabled=l.status==='blocked';$('sendDirect').hidden=!canSendDirect(l);$('sendDirect').disabled=false;wa();$('details').showModal();$('detailBody').scrollTop=0;showHinaStatus(l,'on');}
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
$('manual').onclick=()=>{if(confirm('Tandai sudah dihubungi secara manual?'))change('manual',{});};
$('block').onclick=()=>{if(confirm('Blokir seluruh penawaran selanjutnya untuk lead ini?'))change('block',{});};
