const OWNER="Romuel10";
const REPO="romuel-apps-releases-";
const API=`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`;

const $=id=>document.getElementById(id);
const elApps=$("apps"),elStatus=$("status"),elQ=$("q"),elReload=$("reload"),modal=$("modal");
const modalIconWrap=$("modalIconWrap"),modalTitle=$("modalTitle"),modalMeta=$("modalMeta"),modalDescription=$("modalDescription"),modalChanges=$("modalChanges"),modalDownload=$("modalDownload"),changesBlock=$("changesBlock");
let apps=[];

const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initials=s=>s.trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||"").join("");
const asset=(xs,exts)=>(xs||[]).find(a=>exts.some(e=>a.name.toLowerCase().endsWith(e)));
const fmtDate=s=>{try{return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"long",year:"numeric"}).format(new Date(s))}catch{return""}};

function nameOf(r){
  const t=(r.name||r.tag_name||"Application").trim();
  return t.replace(/\s+[-–—]?\s*v?\d+(?:\.\d+){1,3}.*$/i,"").trim()||t;
}
function versionOf(r){
  const m=`${r.name||""} ${r.tag_name||""}`.match(/v?(\d+(?:\.\d+){1,3})/i);
  return m?m[1]:(r.tag_name||"—");
}
function linesOf(r){return (r.body||"").split("\n").map(x=>x.trim()).filter(Boolean)}
function descriptionOf(r){
  return linesOf(r).find(x=>!x.startsWith("#")&&!/^[-*•]/.test(x))||"Application Android disponible au téléchargement.";
}
function changesOf(r){
  const ls=linesOf(r),d=descriptionOf(r);
  const bullets=ls.filter(x=>/^[-*•]/.test(x)).map(x=>x.replace(/^[-*•]\s*/,""));
  return bullets.length?bullets:ls.filter(x=>x!==d&&!x.startsWith("#")).slice(0,6);
}
function parse(rs){
  const seen=new Set(),out=[];
  rs.filter(r=>!r.draft&&!r.prerelease)
    .sort((a,b)=>new Date(b.published_at||b.created_at)-new Date(a.published_at||a.created_at))
    .forEach(r=>{
      const apk=asset(r.assets,[".apk"]); if(!apk)return;
      const name=nameOf(r),key=name.toLowerCase(); if(seen.has(key))return; seen.add(key);
      const img=asset(r.assets,[".png",".jpg",".jpeg",".webp"]);
      out.push({name,version:versionOf(r),description:descriptionOf(r),changes:changesOf(r),apk:apk.browser_download_url,icon:img?.browser_download_url||"",published:r.published_at||r.created_at});
    });
  return out;
}
function iconHtml(a){
  const n=esc(a.name),ini=esc(initials(a.name));
  return a.icon?`<img class="icon" src="${esc(a.icon)}" alt="Logo ${n}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="fallback" style="display:none">${ini}</div>`:`<div class="fallback">${ini}</div>`;
}
function currentFiltered(){
  const q=elQ.value.trim().toLowerCase();
  return !q?apps:apps.filter(a=>`${a.name} ${a.version} ${a.description}`.toLowerCase().includes(q));
}
function render(list){
  $("appCountHero").textContent=apps.length;
  if(!list.length){elApps.innerHTML='<div class="card">Aucune application trouvée.</div>';return}
  elApps.innerHTML=list.map((a,i)=>`
  <article class="card">
    <div class="head">${iconHtml(a)}<div><h3>${esc(a.name)}</h3><p class="meta">Version ${esc(a.version)} • ${esc(fmtDate(a.published))}</p></div></div>
    <div class="rating-mini"><span class="stars muted-stars">★★★★★</span><span>Aucun avis</span></div>
    <p class="desc">${esc(a.description)}</p>
    <div class="actions"><a class="download" href="${esc(a.apk)}">Télécharger</a><button class="details" type="button" data-details="${i}">Détails</button></div>
  </article>`).join("");
}
function filter(){render(currentFiltered())}
function openDetails(app){
  modalIconWrap.innerHTML=iconHtml(app);
  modalTitle.textContent=app.name;
  modalMeta.textContent=`Version ${app.version} • Mise à jour le ${fmtDate(app.published)}`;
  modalDescription.textContent=app.description;
  modalDownload.href=app.apk;
  if(app.changes?.length){modalChanges.innerHTML=app.changes.map(x=>`<p>• ${esc(x)}</p>`).join("");changesBlock.style.display=""}else{changesBlock.style.display="none"}
  modal.classList.add("show");modal.setAttribute("aria-hidden","false");document.body.classList.add("modal-open");
}
function closeModal(){modal.classList.remove("show");modal.setAttribute("aria-hidden","true");document.body.classList.remove("modal-open")}

elApps.addEventListener("click",e=>{
  const btn=e.target.closest("[data-details]"); if(!btn)return;
  const app=currentFiltered()[Number(btn.dataset.details)]; if(app)openDetails(app);
});
modal.addEventListener("click",e=>{if(e.target.matches("[data-close-modal]"))closeModal()});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal()});
$("shareBtn").addEventListener("click",async()=>{
  const data={title:"Romuel Apps",text:`Découvre ${modalTitle.textContent} sur Romuel Apps`,url:location.href};
  try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(location.href);alert("Lien copié.")}}catch{}
});
$("themeBtn").addEventListener("click",()=>{
  document.body.classList.toggle("light");
  $("themeBtn").textContent=document.body.classList.contains("light")?"☀":"☾";
});

async function load(){
  elStatus.className="status";elStatus.textContent="Chargement des applications…";elReload.disabled=true;
  try{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    const res=await fetch(API,{headers:{"Accept":"application/vnd.github+json"},cache:"no-store",signal:controller.signal});
    clearTimeout(timer); if(!res.ok)throw new Error(`GitHub: ${res.status}`);
    apps=parse(await res.json());
    elStatus.textContent=apps.length?`${apps.length} application${apps.length>1?"s":""} disponible${apps.length>1?"s":""}.`:"Aucune Release avec un fichier APK n'a été trouvée.";
    filter();
  }catch(e){console.error(e);elStatus.className="status error";elStatus.textContent="Le chargement automatique a échoué. Appuie sur « Actualiser ».";elApps.innerHTML=""}
  finally{elReload.disabled=false}
}
elQ.addEventListener("input",filter);elReload.addEventListener("click",load);load();