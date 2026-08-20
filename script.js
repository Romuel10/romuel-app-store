const OWNER="Romuel10";
const REPO="romuel-apps-releases-";
const API=`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`;

const elApps=document.getElementById("apps");
const elStatus=document.getElementById("status");
const elQ=document.getElementById("q");
const elReload=document.getElementById("reload");
let apps=[];

const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initials=s=>s.trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||"").join("");
const asset=(xs,exts)=>(xs||[]).find(a=>exts.some(e=>a.name.toLowerCase().endsWith(e)));
const date=s=>{try{return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"long",year:"numeric"}).format(new Date(s))}catch{return""}};
function nameOf(r){
  const t=(r.name||r.tag_name||"Application").trim();
  return t.replace(/\s+[-–—]?\s*v?\d+(?:\.\d+){1,3}.*$/i,"").trim()||t;
}
function versionOf(r){
  const m=`${r.name||""} ${r.tag_name||""}`.match(/v?(\d+(?:\.\d+){1,3})/i);
  return m?m[1]:(r.tag_name||"—");
}
function descOf(r){
  return (r.body||"").split("\n").map(x=>x.trim()).find(x=>x&&!x.startsWith("#"))||"Application Android disponible au téléchargement.";
}
function parse(rs){
  const seen=new Set(), out=[];
  rs.filter(r=>!r.draft&&!r.prerelease)
    .sort((a,b)=>new Date(b.published_at||b.created_at)-new Date(a.published_at||a.created_at))
    .forEach(r=>{
      const apk=asset(r.assets,[".apk"]); if(!apk)return;
      const name=nameOf(r), key=name.toLowerCase();
      if(seen.has(key))return; seen.add(key);
      const img=asset(r.assets,[".png",".jpg",".jpeg",".webp"]);
      out.push({name,version:versionOf(r),description:descOf(r),apk:apk.browser_download_url,icon:img?.browser_download_url||"",details:r.html_url,published:r.published_at||r.created_at});
    });
  return out;
}
function render(list){
  if(!list.length){elApps.innerHTML='<div class="card">Aucune application trouvée.</div>';return}
  elApps.innerHTML=list.map(a=>{
    const n=esc(a.name), ini=esc(initials(a.name));
    const icon=a.icon?`<img class="icon" src="${esc(a.icon)}" alt="Logo ${n}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="fallback" style="display:none">${ini}</div>`:`<div class="fallback">${ini}</div>`;
    return `<article class="card"><div class="head">${icon}<div><h3>${n}</h3><p class="meta">Version ${esc(a.version)} • ${esc(date(a.published))}</p></div></div><p class="desc">${esc(a.description)}</p><div class="actions"><a class="download" href="${esc(a.apk)}">Télécharger APK</a><a class="details" href="${esc(a.details)}" target="_blank" rel="noopener">Détails</a></div></article>`;
  }).join("");
}
function filter(){const q=elQ.value.trim().toLowerCase();render(!q?apps:apps.filter(a=>`${a.name} ${a.version} ${a.description}`.toLowerCase().includes(q)))}

async function load(){
  elStatus.className=""; elStatus.textContent="Chargement des applications…"; elReload.disabled=true;
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    const res=await fetch(API,{headers:{"Accept":"application/vnd.github+json"},cache:"no-store",signal:controller.signal});
    clearTimeout(timer);
    if(!res.ok)throw new Error(`GitHub: ${res.status}`);
    apps=parse(await res.json());
    elStatus.textContent=apps.length?`${apps.length} application${apps.length>1?"s":""} disponible${apps.length>1?"s":""}.`:"Aucune Release avec un fichier APK n'a été trouvée.";
    filter();
  }catch(e){
    console.error(e);
    elStatus.className="error";
    elStatus.textContent="Le chargement automatique a échoué. Appuie sur « Actualiser ». Si le problème continue, ouvre « Détails » depuis GitHub Releases.";
    elApps.innerHTML="";
  }finally{elReload.disabled=false}
}
elQ.addEventListener("input",filter);
elReload.addEventListener("click",load);
load();