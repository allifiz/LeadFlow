export function initProposalStudio({api,getLeads,isAuthenticated}){
 const $=id=>document.getElementById(id),form=$('proposalForm'),list=$('proposalList'),notice=$('proposalNotice');
 const labels={queued:'Dalam antrean',published:'Dikirim ke GPT',completed:'Siap ditinjau',approved:'Disetujui',failed:'Gagal'};
 const el=(tag,text,cls)=>{const x=document.createElement(tag);if(text!=null)x.textContent=text;if(cls)x.className=cls;return x;};
 const money=v=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(v);
 let sequence=0,bridge=false,loading=false;
 function setNotice(text){notice.textContent=text;}
 function syncCustomers(){
  const select=$('proposalLead'),previous=select.value,options=[new Option('Customer manual','')];
  for(const l of getLeads().filter(x=>x.status!=='blocked').sort((a,b)=>a.name.localeCompare(b.name,'id')))options.push(new Option(l.name,String(l.id)));
  select.replaceChildren(...options);select.value=options.some(x=>x.value===previous)?previous:'';
 }
 $('proposalLead').onchange=()=>{const l=getLeads().find(x=>String(x.id)===$('proposalLead').value);if(l){form.elements.customer.value=l.name;}};
 function link(label,url){const a=el('a',label,'small-button');a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
 function button(label,action){const b=el('button',label,'small-button');b.type='button';b.onclick=async()=>{b.disabled=true;try{await action();}catch(e){setNotice(e.message);}finally{b.disabled=false;}};return b;}
 function row(p){
  const card=el('article',null,'proposal-item'),head=el('div',null,'proposal-item-head');
  const info=el('div');info.append(el('h3',p.customer),el('p',p.input.project+' · '+money(p.input.budget)+' · '+p.input.duration+' hari'));
  head.append(info,el('span',labels[p.state]||p.state,'count-tag'));card.append(head);
  card.append(el('small',(p.parent_id?'Revisi dari '+p.parent_id.slice(0,8)+' · ':'Proposal awal · ')+p.id.slice(0,8)+' · '+p.created_at+' UTC'));
  if(p.result?.summary)card.append(el('p',p.result.summary,'proposal-summary'));
  if(p.result?.error)card.append(el('p',p.result.error,'notice'));
  const actions=el('div',null,'actions');
  if(p.result?.document_id){
   actions.append(link('Buka Google Docs','https://docs.google.com/document/d/'+encodeURIComponent(p.result.document_id)+'/edit'));
   actions.append(link('Preview PDF','https://drive.google.com/file/d/'+encodeURIComponent(p.result.pdf_id)+'/view'));
   actions.append(link('Download PDF','https://drive.google.com/uc?export=download&id='+encodeURIComponent(p.result.pdf_id)));
  }
  if(['queued','published'].includes(p.state)){
   actions.append(button('Coba sambungkan ulang',async()=>{const r=await api('proposal-dispatch',{id:p.id});setNotice(r.notified?'Bridge menerima request.':'Bridge belum merespons; request tetap tersimpan.');await load();}));
  }
  if(p.state==='completed')actions.append(button('Setujui proposal',async()=>{if(!confirm('Tandai proposal ini disetujui? Tidak ada pesan dikirim ke customer.'))return;await api('proposal-approve',{id:p.id});await load();}));
  card.append(actions);
  if(['completed','approved','failed'].includes(p.state)){
   const d=el('details'),summary=el('summary','Buat versi revisi'),f=el('form'),label=el('label','Instruksi revisi'),input=el('textarea');input.rows=3;input.maxLength=3000;input.required=true;input.placeholder='Contoh: sesuaikan harga, fitur dan gaya cover...';label.append(input);const submit=el('button','Generate revisi','primary');f.append(label,submit);d.append(summary,f);card.append(d);
   f.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{const r=await api('proposal-revise',{id:p.id,revision:input.value});d.open=false;setNotice(r.notified?'Revisi dikirim ke bridge.':'Revisi tersimpan; bridge belum merespons.');await load();}catch(e){setNotice(e.message);}finally{submit.disabled=false;}};
  }
  return card;
 }
 async function load(){
  if(!isAuthenticated()||loading)return;
  const seq=++sequence;loading=true;
  try{
   const data=await api('proposal-list');if(seq!==sequence||!isAuthenticated())return;
   bridge=data.bridge_configured;
   $('proposalBridgeStatus').textContent=bridge?'Webhook dikonfigurasi · status pengiriman ditampilkan per proposal':'Webhook belum dikonfigurasi. Request dapat disimpan, tetapi belum diproses GPT.';
   syncCustomers();
   // Do not wipe an open revision editor during background refresh.
   if(!list.querySelector('details[open]'))list.replaceChildren(...(data.proposals.length?data.proposals.map(row):[el('p','Belum ada proposal.','empty')]));
  }catch(e){if(seq===sequence&&isAuthenticated())setNotice(e.message);}finally{loading=false;}
 }
 form.onsubmit=async e=>{
  e.preventDefault();
  const submit=$('proposalSubmit');submit.disabled=true;
  const data=Object.fromEntries(new FormData(form));data.research=form.elements.research.checked;
  try{
   const r=await api('proposal-create',data);
   form.reset();setNotice(r.notified?'Request tersimpan dan dikirim ke Proposal Bridge.':'Request tersimpan. Bridge belum merespons; gunakan coba sambungkan ulang.');
   await load();
  }catch(e){setNotice(e.message);}finally{submit.disabled=false;}
 };
 $('proposalReload').onclick=load;
 setInterval(()=>{if(!document.hidden&&location.hash==='#proposalStudio')load();},15000);
 return {load,reset(){sequence++;form.reset();list.replaceChildren();setNotice('');$('proposalBridgeStatus').textContent='';$('proposalLead').replaceChildren(new Option('Customer manual',''));}};
}
