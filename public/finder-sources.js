export const sourceOptions=['Website publik','Media sosial bisnis','Direktori bisnis','Google Maps','Google Search','Instagram','Facebook','TikTok','LinkedIn','Bridestory','Weddingku','Traveloka','Tripadvisor','Dapodik','Direktori pemerintahan','Direktori asosiasi'];
const groups={'Website publik':['Google Search'],'Media sosial bisnis':['Instagram','Facebook','TikTok','LinkedIn'],'Direktori bisnis':['Bridestory','Weddingku','Traveloka','Tripadvisor','Dapodik','Direktori pemerintahan','Direktori asosiasi']};
export function sourcePlan(c={}){
 const selected=Array.isArray(c.sources)?c.sources:[];
 const allowed=selected.length?[...new Set(selected.flatMap(s=>[s,...(groups[s]||[])]))]:sourceOptions;
 const category=(c.categories||[]).join(' ').toLowerCase(), preferred=[];
 if(/wedding|catering|pernikahan|event/.test(category))preferred.push('Bridestory','Weddingku','Instagram');
 if(/sekolah|pendidikan|bimbingan/.test(category))preferred.push('Dapodik','Google Search','Website publik');
 if(/hotel|villa|travel|wisata|penginapan/.test(category))preferred.push('Traveloka','Tripadvisor','Google Maps');
 if(/notaris|profesional|kontraktor|arsitektur|perusahaan/.test(category))preferred.push('Direktori asosiasi','LinkedIn','Google Search');
 if(/laundry|restoran|kafe|umkm|retail|kuliner|bengkel/.test(category))preferred.push('Google Maps','Instagram','Facebook');
 return [...new Set([c.preferred_source,...preferred,'Google Maps','Google Search','Website publik',...allowed])].filter(s=>s&&allowed.includes(s));
}
const domains=[['Google Maps',['maps.app.goo.gl','maps.google.com']],['Instagram',['instagram.com']],['Facebook',['facebook.com','fb.com']],['TikTok',['tiktok.com']],['LinkedIn',['linkedin.com']],['Bridestory',['bridestory.com']],['Weddingku',['weddingku.com']],['Traveloka',['traveloka.com']],['Tripadvisor',['tripadvisor.com','tripadvisor.co.id']],['Dapodik',['dapo.kemdikbud.go.id','dapo.kemendikdasmen.go.id','referensi.data.kemdikbud.go.id','referensi.data.kemendikdasmen.go.id']]];
export function sourceLabel(value){
 try{const u=new URL(value),host=u.hostname.toLowerCase().replace(/^www\./,'');if(!['http:','https:'].includes(u.protocol))return 'Tidak diketahui';
 if((host==='google.com'||host==='google.co.id'||host==='goo.gl')&&/^\/maps(?:\/|$)/.test(u.pathname))return 'Google Maps';
 if((host==='google.com'||host==='google.co.id')&&u.pathname==='/search')return 'Google Search';
 return domains.find(([,ds])=>ds.some(d=>host===d||host.endsWith('.'+d)))?.[0]||(host.endsWith('.go.id')?'Direktori pemerintahan':host);
 }catch{return 'Tidak diketahui';}
}
export function summarizeSources(rows){
 const totals=new Map();
 for(const r of rows){const source=sourceLabel(r.source),key=JSON.stringify([r.campaign_id,source]);const item=totals.get(key)||{campaign_id:r.campaign_id,source,added:0};item.added+=Number(r.added)||0;totals.set(key,item);}
 return [...totals.values()].sort((a,b)=>b.added-a.added||a.source.localeCompare(b.source));
}
