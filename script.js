const OWNER="Romuel10";
const REPO="romuel-apps-releases-";
const API=`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`;

const SUPABASE_URL="https://gmlofgsgnbbcbefogpww.supabase.co";
const SUPABASE_KEY="sb_publishable_5TlVWknK1BODxwWqw4efEA_y4DI-JRP";
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);

const $=id=>document.getElementById(id);
const elApps=$("apps"),elStatus=$("status"),elQ=$("q"),elReload=$("reload");
const modal=$("modal"),authModal=$("authModal");
let apps=[],currentApp=null,currentUser=null,currentRating=0,authMode="signin",reviewStats={};
let favorites=new Set(JSON.parse(localStorage.getItem("romuelapps_favorites")||"[]"));

const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initials=s=>s.trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||"").join("");
const asset=(xs,exts)=>(xs||[]).find(a=>exts.some(e=>a.name.toLowerCase().endsWith(e)));
const imageAssets=xs=>(xs||[]).filter(a=>[".png",".jpg",".jpeg",".webp"].some(e=>a.name.toLowerCase().endsWith(e)));
const isIconName=n=>/(^|[-_.])(icon|logo|appicon|app-icon)([-_.]|$)/i.test(n);
const fmtDate=s=>{try{return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"long",year:"numeric"}).format(new Date(s))}catch{return""}};
const slugify=s=>s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");

function nameOf(r){const t=(r.name||r.tag_name||"Application").trim();return t.replace(/\s+[-–—]?\s*v?\d+(?:\.\d+){1,3}.*$/i,"").trim()||t}
function versionOf(r){const m=`${r.name||""} ${r.tag_name||""}`.match(/v?(\d+(?:\.\d+){1,3})/i);return m?m[1]:(r.tag_name||"—")}
function linesOf(r){return (r.body||"").split("\n").map(x=>x.trim()).filter(Boolean)}
function descriptionOf(r){return linesOf(r).find(x=>!x.startsWith("#")&&!/^[-*•]/.test(x))||"Application Android disponible au téléchargement."}
function changesOf(r){const ls=linesOf(r),d=descriptionOf(r),b=ls.filter(x=>/^[-*•]/.test(x)).map(x=>x.replace(/^[-*•]\s*/,""));return b.length?b:ls.filter(x=>x!==d&&!x.startsWith("#")).slice(0,6)}

function parse(rs){
  const seen=new Set(),out=[];
  rs.filter(r=>!r.draft&&!r.prerelease).sort((a,b)=>new Date(b.published_at||b.created_at)-new Date(a.published_at||a.created_at)).forEach(r=>{
    const apk=asset(r.assets,[".apk"]); if(!apk)return;
    const name=nameOf(r),key=name.toLowerCase(); if(seen.has(key))return; seen.add(key);
    const imgs=imageAssets(r.assets);
    const iconAsset=imgs.find(x=>isIconName(x.name))||imgs[0];
    const screenshots=imgs.filter(x=>x!==iconAsset).map(x=>x.browser_download_url);
    out.push({
      id:slugify(name),name,version:versionOf(r),description:descriptionOf(r),changes:changesOf(r),
      apk:apk.browser_download_url,downloads:apk.download_count||0,
      icon:iconAsset?.browser_download_url||"",screenshots,
      published:r.published_at||r.created_at
    });
  });
  return out;
}
function iconHtml(a){const n=esc(a.name),ini=esc(initials(a.name));return a.icon?`<img class="icon" src="${esc(a.icon)}" alt="Logo ${n}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="fallback" style="display:none">${ini}</div>`:`<div class="fallback">${ini}</div>`}
function starsFrom(avg){const n=Math.round(Number(avg)||0);return "★★★★★".split("").map((s,i)=>i<n?"★":"☆").join("")}
function currentFiltered(){
  const q=elQ.value.trim().toLowerCase();
  let list=!q?[...apps]:apps.filter(a=>`${a.name} ${a.version} ${a.description}`.toLowerCase().includes(q));
  const mode=$("sortSelect").value;
  if(mode==="popular") list.sort((a,b)=>(b.downloads||0)-(a.downloads||0));
  else if(mode==="rating") list.sort((a,b)=>(reviewStats[b.id]?.avg||0)-(reviewStats[a.id]?.avg||0));
  else list.sort((a,b)=>new Date(b.published)-new Date(a.published));
  return list;
}

function render(list){
  $("appCountHero").textContent=apps.length;
  if(!list.length){elApps.innerHTML='<div class="card">Aucune application trouvée.</div>';return}
  elApps.innerHTML=list.map((a,i)=>{
    const st=reviewStats[a.id]||{avg:0,count:0};
    return `<article class="card">
      <div class="head">${iconHtml(a)}<div><h3>${esc(a.name)}</h3><p class="meta">Version ${esc(a.version)} • ${esc(fmtDate(a.published))}</p></div></div>
      <div class="rating-mini"><span class="stars">${starsFrom(st.avg)}</span><span>${st.count?`${st.avg.toFixed(1)} (${st.count} avis)`:"Aucun avis"}</span></div>
      <div class="rating-mini"><span>⬇ ${Number(a.downloads||0).toLocaleString("fr-FR")} téléchargement${a.downloads===1?"":"s"}</span>${favorites.has(a.id)?"<span>♥ Favori</span>":""}</div>
      <p class="desc">${esc(a.description)}</p>
      <div class="actions"><a class="download" href="${esc(a.apk)}">Télécharger</a><button class="details" type="button" data-details="${i}">Détails</button></div>
    </article>`;
  }).join("");
}
function filter(){render(currentFiltered())}

async function loadReviewStats(){
  if(!apps.length)return;
  const ids=apps.map(a=>a.id);
  const {data,error}=await sb.from("reviews").select("app_id,rating").in("app_id",ids);
  if(error){console.warn(error);return}
  const map={};
  for(const id of ids)map[id]={avg:0,count:0,sum:0};
  for(const r of data||[]){if(!map[r.app_id])map[r.app_id]={avg:0,count:0,sum:0};map[r.app_id].count++;map[r.app_id].sum+=r.rating}
  for(const id of Object.keys(map))map[id].avg=map[id].count?map[id].sum/map[id].count:0;
  reviewStats=map;filter();
}

async function loadReviewsForCurrentApp(){
  if(!currentApp)return;
  const {data,error}=await sb.from("reviews").select("id,user_id,user_name,rating,comment,created_at").eq("app_id",currentApp.id).order("created_at",{ascending:false});
  if(error){$("reviewsList").innerHTML='<p class="form-message error">Impossible de charger les avis.</p>';return}

  const rows=data||[];
  const avg=rows.length?rows.reduce((s,r)=>s+r.rating,0)/rows.length:0;
  $("modalStars").textContent=starsFrom(avg);
  $("modalRatingText").textContent=rows.length?`${avg.toFixed(1)} / 5 • ${rows.length} avis`:"Aucun avis";
  $("reviewSummaryText").textContent=rows.length?`${rows.length} avis • note moyenne ${avg.toFixed(1)} / 5`:"Aucun avis pour le moment.";

  $("reviewsList").innerHTML=rows.length?rows.map(r=>`
    <article class="review-item">
      <div class="review-top">
        <div><div class="review-name">${esc(r.user_name||"Utilisateur")}</div><div class="stars">${starsFrom(r.rating)}</div></div>
        <span class="review-date">${esc(fmtDate(r.created_at))}</span>
      </div>
      <p class="review-comment">${esc(r.comment)}</p>
    </article>`).join(""):'<p class="form-message">Sois le premier à donner ton avis.</p>';

  updateReviewComposer(rows);
}

function updateReviewComposer(rows=[]){
  $("loggedOutReview").classList.toggle("hidden",!!currentUser);
  $("reviewForm").classList.toggle("hidden",!currentUser);
  if(!currentUser)return;

  const mine=rows.find(r=>r.user_id===currentUser.id);
  currentRating=mine?.rating||0;
  $("reviewComment").value=mine?.comment||"";
  $("deleteReviewBtn").classList.toggle("hidden",!mine);
  paintStars(currentRating);
}

function paintStars(n){document.querySelectorAll("#starPicker button").forEach(b=>b.classList.toggle("active",Number(b.dataset.rating)<=n))}

function openDetails(app){
  currentApp=app;
  $("modalIconWrap").innerHTML=iconHtml(app);
  $("modalTitle").textContent=app.name;
  $("modalMeta").textContent=`Version ${app.version} • Mise à jour le ${fmtDate(app.published)}`;
  $("modalDescription").textContent=app.description;
  $("modalDownload").href=app.apk;
  $("modalDownloads").textContent=`${Number(app.downloads||0).toLocaleString("fr-FR")} téléchargement${app.downloads===1?"":"s"}`;
  $("favoriteBtn").textContent=favorites.has(app.id)?"♥ Favori":"♡ Favori";
  $("favoriteBtn").classList.toggle("favorite-active",favorites.has(app.id));
  if(app.changes?.length){$("modalChanges").innerHTML=app.changes.map(x=>`<p>• ${esc(x)}</p>`).join("");$("changesBlock").style.display=""}else{$("changesBlock").style.display="none"}
  if(app.screenshots?.length){
    $("screensGallery").innerHTML=app.screenshots.map((src,i)=>`<img src="${esc(src)}" alt="Capture ${i+1} de ${esc(app.name)}">`).join("");
    $("screensSection").classList.remove("hidden");
  }else{
    $("screensGallery").innerHTML="";
    $("screensSection").classList.add("hidden");
  }
  modal.classList.add("show");modal.setAttribute("aria-hidden","false");document.body.classList.add("modal-open");
  loadReviewsForCurrentApp();
}
function closeModal(){modal.classList.remove("show");modal.setAttribute("aria-hidden","true");document.body.classList.remove("modal-open");currentApp=null}

function openAuth(){
  authModal.classList.add("show");authModal.setAttribute("aria-hidden","false");document.body.classList.add("modal-open");
  refreshAuthUI();
}
function closeAuth(){authModal.classList.remove("show");authModal.setAttribute("aria-hidden","true");document.body.classList.remove("modal-open")}

function setAuthMode(mode){
  authMode=mode;
  $("signInTab").classList.toggle("active",mode==="signin");
  $("signUpTab").classList.toggle("active",mode==="signup");
  $("authTitle").textContent=mode==="signin"?"Connexion":"Créer un compte";
  $("authSubmitBtn").textContent=mode==="signin"?"Se connecter":"Créer mon compte";
  $("authPassword").autocomplete=mode==="signin"?"current-password":"new-password";
  $("authMessage").textContent="";
}
function refreshAuthUI(){
  $("authLoggedOut").classList.toggle("hidden",!!currentUser);
  $("authLoggedIn").classList.toggle("hidden",!currentUser);
  $("accountBtn").textContent=currentUser?(currentUser.email||"Mon compte"):"Se connecter";
  if(currentUser)$("currentUserEmail").textContent=currentUser.email||"Utilisateur connecté";
  if(currentApp)loadReviewsForCurrentApp();
}

async function loadApps(){
  elStatus.className="status";elStatus.textContent="Chargement des applications…";elReload.disabled=true;
  try{
    const c=new AbortController(),t=setTimeout(()=>c.abort(),12000);
    const res=await fetch(API,{headers:{"Accept":"application/vnd.github+json"},cache:"no-store",signal:c.signal});clearTimeout(t);
    if(!res.ok)throw new Error(`GitHub: ${res.status}`);
    apps=parse(await res.json());
    elStatus.textContent=apps.length?`${apps.length} application${apps.length>1?"s":""} disponible${apps.length>1?"s":""}.`:"Aucune Release avec un fichier APK n'a été trouvée.";
    filter();await loadReviewStats();
  }catch(e){console.error(e);elStatus.className="status error";elStatus.textContent="Le chargement automatique a échoué. Appuie sur « Actualiser ».";elApps.innerHTML=""}
  finally{elReload.disabled=false}
}

elApps.addEventListener("click",e=>{const btn=e.target.closest("[data-details]");if(!btn)return;const app=currentFiltered()[Number(btn.dataset.details)];if(app)openDetails(app)});
modal.addEventListener("click",e=>{if(e.target.matches("[data-close-modal]"))closeModal()});
authModal.addEventListener("click",e=>{if(e.target.matches("[data-close-auth]"))closeAuth()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeModal();closeAuth()}});

$("accountBtn").addEventListener("click",openAuth);
$("loginFromReviewBtn").addEventListener("click",openAuth);
$("signInTab").addEventListener("click",()=>setAuthMode("signin"));
$("signUpTab").addEventListener("click",()=>setAuthMode("signup"));

$("authForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const email=$("authEmail").value.trim(),password=$("authPassword").value;
  const msg=$("authMessage");msg.className="form-message";msg.textContent="Traitement…";
  let result;
  if(authMode==="signin")result=await sb.auth.signInWithPassword({email,password});
  else result=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.origin}});
  if(result.error){msg.className="form-message error";msg.textContent=result.error.message;return}
  if(authMode==="signup"&&!result.data.session){msg.className="form-message success";msg.textContent="Compte créé. Vérifie ton e-mail pour confirmer l'inscription.";return}
  msg.className="form-message success";msg.textContent="Connexion réussie.";
  setTimeout(closeAuth,500);
});

$("signOutBtn").addEventListener("click",async()=>{await sb.auth.signOut();closeAuth()});
sb.auth.onAuthStateChange((_event,session)=>{currentUser=session?.user||null;refreshAuthUI()});
(async()=>{const {data}=await sb.auth.getSession();currentUser=data.session?.user||null;refreshAuthUI()})();

document.querySelectorAll("#starPicker button").forEach(btn=>btn.addEventListener("click",()=>{currentRating=Number(btn.dataset.rating);paintStars(currentRating)}));

$("reviewForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const msg=$("reviewMessage");msg.className="form-message";
  if(!currentUser||!currentApp)return;
  if(!currentRating){msg.className="form-message error";msg.textContent="Choisis une note entre 1 et 5 étoiles.";return}
  const comment=$("reviewComment").value.trim();
  if(comment.length<2){msg.className="form-message error";msg.textContent="Écris un commentaire un peu plus long.";return}
  msg.textContent="Publication…";
  const userName=(currentUser.email||"Utilisateur").split("@")[0];
  const payload={app_id:currentApp.id,user_id:currentUser.id,user_name:userName,rating:currentRating,comment};
  const {error}=await sb.from("reviews").upsert(payload,{onConflict:"user_id,app_id"});
  if(error){msg.className="form-message error";msg.textContent=error.message;return}
  msg.className="form-message success";msg.textContent="Ton avis a été enregistré.";
  await loadReviewsForCurrentApp();await loadReviewStats();
});

$("deleteReviewBtn").addEventListener("click",async()=>{
  if(!currentUser||!currentApp)return;
  const {error}=await sb.from("reviews").delete().eq("app_id",currentApp.id).eq("user_id",currentUser.id);
  const msg=$("reviewMessage");
  if(error){msg.className="form-message error";msg.textContent=error.message;return}
  currentRating=0;$("reviewComment").value="";paintStars(0);msg.className="form-message success";msg.textContent="Ton avis a été supprimé.";
  await loadReviewsForCurrentApp();await loadReviewStats();
});

$("favoriteBtn").addEventListener("click",()=>{
  if(!currentApp)return;
  if(favorites.has(currentApp.id))favorites.delete(currentApp.id);else favorites.add(currentApp.id);
  localStorage.setItem("romuelapps_favorites",JSON.stringify([...favorites]));
  $("favoriteBtn").textContent=favorites.has(currentApp.id)?"♥ Favori":"♡ Favori";
  $("favoriteBtn").classList.toggle("favorite-active",favorites.has(currentApp.id));
  filter();
});

$("sortSelect").addEventListener("change",filter);

$("shareBtn").addEventListener("click",async()=>{const data={title:"Romuel Apps",text:`Découvre ${$("modalTitle").textContent} sur Romuel Apps`,url:location.href};try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(location.href);alert("Lien copié.")}}catch{}});
$("themeBtn").addEventListener("click",()=>{document.body.classList.toggle("light");$("themeBtn").textContent=document.body.classList.contains("light")?"☀":"☾"});
elQ.addEventListener("input",filter);elReload.addEventListener("click",loadApps);loadApps();
