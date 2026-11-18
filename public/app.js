const $=id=>document.getElementById(id);
let token='', leads=[], state={}, selected;
const api=async(action,body)=>{
 const r=await fetch('/api/leadflow?action='+action,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const result=await r.json();if(!r.ok)throw Error(result.error||'Request gagal');return result;
};
const label={new:'Baru',sending:'Sedang mengirim',submitted:'Diajukan ke Meta',unknown:'Perlu cek',manual:'Manual',blocked:'Jangan hubungi'};
const node=(tag,text,cls)=>{const x=document.createElement(tag);if(text!=null)x.textContent=text;if(cls)x.className=cls;return x};
async function refresh(){state=await api('list');leads=state.leads;$('total').textContent=leads.length;$('fresh').textContent=leads.filter(x=>x.status==='new').length;$('sent').textContent=leads.filter(x=>x.status==='submitted').length;$('unknown').textContent=leads.filter(x=>['unknown','sending'].includes(x.status)).length;$('automationState').textContent=!state.configured?'Belum dikonfigurasi di Vercel':state.paused?'Dijeda':'Aktif untuk lead yang memiliki opt-in';$('pause').textContent=state.paused?'Aktifkan antrean':'Jeda antrean';$('pause').disabled=!state.configured&&state.paused;render();}
// Manual click-to-chat only. Opening WhatsApp never records consent or delivery.
function canOpenWa(l){return l?.status==='new'&&!l.blocked_at&&/^628\d{7,12}$/.test(l.phone||'');}
function waUrl(l,message){return 'https://wa.me/'+l.phone+'?text='+encodeURIComponent(message||'');}
function render(){
 const search=$('search').value.toLowerCase(),status=$('filter').value;
 const visible=leads.filter(x=>(!status||x.status===status)&&[x.name,x.phone,x.email,x.category].join(' ').toLowerCase().includes(search));
 $('rows').replaceChildren();$('empty').hidden=visible.length>0;
 for(const l of visible){const tr=node('tr');const name=node('td');name.append(node('strong',l.name),node('small',[l.category,l.location].filter(Boolean).join(' · ')));if(/^https?:\/\//i.test(l.source)){const a=node('a','Sumber');a.href=l.source;a.target='_blank';a.rel='noopener noreferrer';name.append(a);}
 const phone=node('td',l.phone?'+'+l.phone:'—');if(l.wa_verified)phone.append(node('small','WA terverifikasi'));const st=node('td');st.append(node('span',label[l.status]||l.status,'pill '+l.status));if(l.opt_in_at)st.append(node('small','Opt-in tercatat'));
 const actions=node('td');const b=node('button','Detail');b.onclick=()=>open(l);actions.append(b);
 if(canOpenWa(l)){
  const send=node('a','Kirim pesan','button');
  send.href=waUrl(l,l.draft);send.target='_blank';send.rel='noopener noreferrer';send.style.display='inline-block';send.style.marginLeft='6px';
  send.title='Buka WhatsApp dengan draft; periksa izin penerima dan tekan Kirim di WhatsApp.';
  send.onclick=()=>{$('notice').textContent='WhatsApp dibuka untuk '+l.name+'. Pesan belum terkirim; tandai sudah dihubungi setelah mengirim.';};
  actions.append(send);
 }else{const send=node('button','Kirim pesan');send.disabled=true;send.style.marginLeft='6px';send.title=l.status!=='new'?'Lead sudah ditangani atau diblokir':'Nomor seluler tidak tersedia';actions.append(send);}
 tr.append(name,phone,node('td',l.email||'—'),st,actions);$('rows').append(tr);}
}
function parseImport(text){try{const parsed=JSON.parse(text);return Array.isArray(parsed)?parsed:parsed.leads;}catch{
 const clean=s=>s.replace(/\*\*/g,'').replace(/^\d+\.\s*/,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').trim();
 return text.split('\n').filter(x=>x.trim().startsWith('|')).map(x=>x.trim().replace(/^\||\|$/g,'').split('|').map(clean)).filter(x=>x.length>=3&&!/calon customer|list calon|^[-:\s]+$/.test(x[0].toLowerCase())).map((x,i)=>({name:x[0],phone:x[1].replace(/\s*\(.+\)$/,''),email:(x[2].match(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i)||[])[0]||'',priority:Math.max(0,100-i)}));
 }}
$('loginForm').onsubmit=async e=>{e.preventDefault();token=$('token').value;try{await refresh();$('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('token').value='';}catch(e){token='';$('loginError').textContent=e.message;}};
$('logout').onclick=()=>{token='';leads=[];state={};selected=null;$('rows').replaceChildren();$('workspace').hidden=true;$('login').hidden=false;$('logout').hidden=true;$('loginError').textContent='';};
$('search').oninput=render;$('filter').onchange=render;
$('reload').onclick=()=>refresh().catch(e=>$('notice').textContent=e.message);
$('pause').onclick=async()=>{if(state.paused&&!confirm('Aktifkan pengiriman pertama otomatis hanya ke kontak dengan opt-in?'))return;try{await api('pause',{paused:!state.paused});await refresh();}catch(e){$('notice').textContent=e.message;}};
$('import').onclick=async()=>{try{const rows=parseImport($('importData').value);if(!Array.isArray(rows)||!rows.length)throw Error('Data kosong / format tidak valid');const r=await api('import',{leads:rows});$('importResult').textContent='Ditambah '+r.added+' · Duplikat '+r.duplicates+' · Invalid '+r.errors.length;await refresh();}catch(e){$('importResult').textContent=e.message;}};
function open(l){selected=l;$('detailName').textContent=l.name;$('detailInfo').textContent=[l.phone,l.email,label[l.status],l.last_error].filter(Boolean).join(' · ');$('message').value=l.draft;$('evidence').value=l.opt_in_evidence||'';$('confirmed').checked=false;$('detailNotice').textContent=l.draft_engine==='AI'?'Draft AI tersimpan: '+(l.draft_model||''):'Draft awal: template lokal';$('consent').disabled=l.status!=='new';$('manual').disabled=l.status!=='new';$('generate').textContent='Generate draft';$('generate').disabled=l.status==='blocked';$('copy').disabled=l.status==='blocked';wa();$('details').showModal();}
function wa(){const available=canOpenWa(selected);$('waLink').hidden=!available;if(available){$('waLink').href=waUrl(selected,$('message').value);$('waLink').title='Buka draft di WhatsApp; belum dikirim';}}
$('message').oninput=wa;
$('waLink').onclick=()=>{$('detailNotice').textContent='WhatsApp dibuka. Periksa izin penerima dan kirim sendiri; status belum berubah.';};
$('generate').onclick=async()=>{
 const id=selected.id, previous=$('message').value;
 $('generate').disabled=true;$('generate').textContent='Generating...';$('detailNotice').textContent='Menghubungi 9Router...';
 try{
  const r=await api('draft',{id,previous});
  const l=leads.find(x=>x.id===id);
  if(l)Object.assign(l,{draft:r.draft,draft_engine:r.engine,draft_model:r.model});
  if(selected?.id===id&&$('details').open){$('message').value=r.draft;wa();$('detailNotice').textContent='Draft AI tersimpan: '+r.model;}
 }catch(e){if(selected?.id===id&&$('details').open)$('detailNotice').textContent=e.message;}
 finally{if(selected?.id===id){$('generate').disabled=selected.status==='blocked';$('generate').textContent='Generate draft';}}
};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('message').value);$('detailNotice').textContent='Draft disalin. Periksa izin penerima sebelum menghubungi.';}catch{$('detailNotice').textContent='Clipboard tidak tersedia; pilih teks secara manual.';}};
async function change(action,data){try{await api(action,{id:selected.id,...data});await refresh();$('details').close();}catch(e){$('detailNotice').textContent=e.message;}}
$('consent').onclick=()=>change('consent',{evidence:$('evidence').value,confirmed:$('confirmed').checked});
$('manual').onclick=()=>{if(confirm('Tandai sudah dihubungi secara manual?'))change('manual',{});};
$('block').onclick=()=>{if(confirm('Blokir seluruh penawaran selanjutnya untuk lead ini?'))change('block',{});};
