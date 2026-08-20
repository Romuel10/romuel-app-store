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
let currentStoreTab="home";
let privateApps=[];
let favorites=new Set(JSON.parse(localStorage.getItem("romuelapps_favorites")||"[]"));
let profile=null,isAdmin=false,reportedReviewId=null;
let selectedAvatarFile=null,removeAvatarRequested=false;
let pendingAppSlug=new URLSearchParams(location.search).get("app");

const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initials=s=>s.trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||"").join("");
const asset=(xs,exts)=>(xs||[]).find(a=>exts.some(e=>a.name.toLowerCase().endsWith(e)));
const imageAssets=xs=>(xs||[]).filter(a=>[".png",".jpg",".jpeg",".webp"].some(e=>a.name.toLowerCase().endsWith(e)));
const isIconName=n=>/(logo|icon|appicon|app-icon)/i.test(n);
const isScreenshotName=n=>/(screenshot|screen-shot|screen|capture|preview)/i.test(n);
const fmtDate=s=>{try{return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"long",year:"numeric"}).format(new Date(s))}catch{return""}};
const slugify=s=>s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");

function appPageUrl(app){
  const u=new URL(location.origin+location.pathname);
  u.searchParams.set("app",app.id);
  return u.toString();
}

function setAppUrl(app,replace=false){
  const url=app?appPageUrl(app):(location.origin+location.pathname);
  history[replace?"replaceState":"pushState"]({app:app?.id||null},"",url);
}

async function trackDownload(app){
  try{
    await sb.from("download_events").insert({
      app_id:app.id,
      version:app.version,
      user_id:currentUser?.id||null
    });
  }catch(e){console.warn("download tracking",e)}
}


function nameOf(r){const t=(r.name||r.tag_name||"Application").trim();return t.replace(/\s+[-–—]?\s*v?\d+(?:\.\d+){1,3}.*$/i,"").trim()||t}
function versionOf(r){const m=`${r.name||""} ${r.tag_name||""}`.match(/v?(\d+(?:\.\d+){1,3})/i);return m?m[1]:(r.tag_name||"—")}
function linesOf(r){return (r.body||"").split("\n").map(x=>x.trim()).filter(Boolean)}

function categoryOf(r){
  const text=`${r.name||""} ${r.body||""}`.toLowerCase();
  const tag=(r.tag_name||"").toLowerCase();

  const explicit=(r.body||"").match(/(?:catégorie|categorie|category)\s*:\s*([^\n]+)/i);
  if(explicit)return explicit[1].trim();

  if(/école|ecole|education|élève|eleve|cours|classe|lycée|lycee/.test(text))return "Éducation";
  if(/planning|effectif|personnel|rh|ressources humaines|gestion/.test(text))return "Gestion";
  if(/photo|image|camera|vidéo|video/.test(text))return "Photo & Média";
  if(/outil|utilitaire|utility|convert|calcul/.test(text))return "Outils";
  if(/commerce|vente|stock|market|boutique/.test(text))return "Commerce";
  return "Autres";
}

function isNewApp(app){
  return (Date.now()-new Date(app.published).getTime()) <= 30*24*60*60*1000;
}
function descriptionOf(r){return linesOf(r).find(x=>!x.startsWith("#")&&!/^[-*•]/.test(x))||"Application Android disponible au téléchargement."}
function changesOf(r){const ls=linesOf(r),d=descriptionOf(r),b=ls.filter(x=>/^[-*•]/.test(x)).map(x=>x.replace(/^[-*•]\s*/,""));return b.length?b:ls.filter(x=>x!==d&&!x.startsWith("#")).slice(0,6)}

function parse(rs){
  const usable=rs.filter(r=>!r.draft&&!r.prerelease)
    .sort((a,b)=>new Date(b.published_at||b.created_at)-new Date(a.published_at||a.created_at));

  const groups=new Map();

  for(const r of usable){
    const apk=asset(r.assets,[".apk"]);
    if(!apk)continue;

    const name=nameOf(r), key=slugify(name);
    const imgs=imageAssets(r.assets);

    // v10 strict rule: only logo/icon can be used as icon.
    const iconAsset=imgs.find(x=>isIconName(x.name));
    const screenshots=imgs.filter(x=>x!==iconAsset).map(x=>x.browser_download_url);

    const releaseData={
      id:key,
      name,
      version:versionOf(r),
      category:categoryOf(r),
      description:descriptionOf(r),
      changes:changesOf(r),
      apk:apk.browser_download_url,
      downloads:apk.download_count||0,
      icon:iconAsset?.browser_download_url||"",
      screenshots,
      published:r.published_at||r.created_at
    };

    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(releaseData);
  }

  const out=[];
  for(const versions of groups.values()){
    const latest=versions[0];
    latest.versions=versions.map(v=>({
      version:v.version,
      apk:v.apk,
      published:v.published,
      changes:v.changes
    }));
    out.push(latest);
  }
  return out;
}

function iconHtml(a){const n=esc(a.name),ini=esc(initials(a.name));return a.icon?`<img class="icon" src="${esc(a.icon)}" alt="Logo ${n}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="fallback" style="display:none">${ini}</div>`:`<div class="fallback">${ini}</div>`}
function starsFrom(avg){const n=Math.round(Number(avg)||0);return "★★★★★".split("").map((s,i)=>i<n?"★":"☆").join("")}
function currentFiltered(){
  const q=elQ.value.trim().toLowerCase();
  const cat=$("categoryFilter").value;
  let list=!q?[...apps]:apps.filter(a=>`${a.name} ${a.version} ${a.description} ${a.category}`.toLowerCase().includes(q));
  if(cat!=="all")list=list.filter(a=>a.category===cat);
  return list;
}

function render(list){
  $("appCountHero").textContent=apps.length;
  if(!list.length){elApps.innerHTML='<div class="card">Aucune application trouvée.</div>';return}
  elApps.innerHTML=list.map((a,i)=>{
    const st=reviewStats[a.id]||{avg:0,count:0};
    return `<article class="card">
      <div class="head">${iconHtml(a)}<div><h3>${esc(a.name)}</h3><p class="meta">Version ${esc(a.version)} • ${esc(fmtDate(a.published))}</p><div class="detail-badges"><span class="category-badge">${esc(a.category)}</span>${isNewApp(a)?'<span class="new-badge">Nouveau</span>':""}</div></div></div>
      <div class="rating-mini"><span class="stars">${starsFrom(st.avg)}</span><span>${st.count?`${st.avg.toFixed(1)} (${st.count} avis)`:"Aucun avis"}</span></div>
      <div class="rating-mini"><span>⬇ ${Number(a.downloads||0).toLocaleString("fr-FR")} téléchargement${a.downloads===1?"":"s"}</span>${favorites.has(a.id)?"<span>♥ Favori</span>":""}</div>
      <p class="desc">${esc(a.description)}</p>
      <div class="actions"><a class="download" href="${esc(a.apk)}">Télécharger</a><button class="details" type="button" data-details="${i}">Détails</button></div>
    </article>`;
  }).join("");
}

function featureCard(a){
  const st=reviewStats[a.id]||{avg:0,count:0};
  return `<article class="feature-card">
    <div class="head">${iconHtml(a)}<div><h4>${esc(a.name)}</h4><p class="meta">Version ${esc(a.version)}</p><span class="category-badge">${esc(a.category)}</span></div></div>
    <div class="rating-mini"><span class="stars">${starsFrom(st.avg)}</span><span>${st.count?`${st.avg.toFixed(1)} (${st.count})`:"Aucun avis"}</span></div>
    <p class="desc">${esc(a.description)}</p>
    <div class="feature-actions"><a class="download" href="${esc(a.apk)}">Télécharger</a><button class="details" data-feature-app="${esc(a.id)}" type="button">Détails</button></div>
  </article>`;
}

function renderHome(){
  const recent=[...apps].sort((a,b)=>new Date(b.published)-new Date(a.published)).slice(0,6);
  const popular=[...apps].sort((a,b)=>(b.downloads||0)-(a.downloads||0)).slice(0,6);
  const rated=[...apps].sort((a,b)=>{
    const A=reviewStats[a.id]||{avg:0,count:0},B=reviewStats[b.id]||{avg:0,count:0};
    if(B.avg!==A.avg)return B.avg-A.avg;
    return B.count-A.count;
  }).slice(0,6);

  $("newApps").innerHTML=recent.length?recent.map(featureCard).join(""):'<div class="empty-state">Aucune application.</div>';
  $("popularApps").innerHTML=popular.length?popular.map(featureCard).join(""):'<div class="empty-state">Aucune application.</div>';
  $("ratedApps").innerHTML=rated.length?rated.map(featureCard).join(""):'<div class="empty-state">Aucune application.</div>';
}

function refreshStoreView(){
  $("appCountHero").textContent=apps.length;
  document.querySelectorAll(".store-tab").forEach(b=>b.classList.toggle("active",b.dataset.storeTab===currentStoreTab));
  $("homeView").classList.toggle("hidden",currentStoreTab!=="home");
  $("catalogView").classList.toggle("hidden",currentStoreTab==="home" || currentStoreTab==="gendarmerie");
  $("gendarmerieView").classList.toggle("hidden",currentStoreTab!=="gendarmerie");

  if(currentStoreTab==="home"){renderHome();return}
  if(currentStoreTab==="gendarmerie"){loadPrivateApps();return}

  let list=currentFiltered();
  if(currentStoreTab==="favorites"){
    list=list.filter(a=>favorites.has(a.id));
    $("catalogTitle").textContent="Mes favoris";
  }else{
    $("catalogTitle").textContent="Toutes les applications";
  }
  render(list);
}

function filter(){
  if(currentStoreTab==="home")renderHome();
  else refreshStoreView();
}

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
      ${currentUser && currentUser.id!==r.user_id ? `<div class="review-actions"><button class="report-btn" type="button" data-report-review="${r.id}">🚩 Signaler</button></div>` : ""}
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

function setAvatarPreview(url=""){
  const img=$("profileAvatarPreview"),fallback=$("profileAvatarFallback");
  if(url){
    img.src=url;
    img.style.display="block";
    fallback.style.display="none";
  }else{
    img.removeAttribute("src");
    img.style.display="none";
    fallback.style.display="grid";
  }
}

function avatarFileExt(file){
  const byType={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"};
  return byType[file.type]||"jpg";
}

async function uploadAvatarIfNeeded(){
  if(!currentUser)return profile?.avatar_url||null;

  if(removeAvatarRequested){
    const {data:files}=await sb.storage.from("avatars").list(currentUser.id);
    if(files?.length){
      await sb.storage.from("avatars").remove(files.map(f=>`${currentUser.id}/${f.name}`));
    }
    return null;
  }

  if(!selectedAvatarFile)return profile?.avatar_url||null;

  if(selectedAvatarFile.size>5*1024*1024)throw new Error("La photo ne doit pas dépasser 5 Mo.");

  const ext=avatarFileExt(selectedAvatarFile);
  const path=`${currentUser.id}/avatar.${ext}`;

  const {data:files}=await sb.storage.from("avatars").list(currentUser.id);
  if(files?.length){
    await sb.storage.from("avatars").remove(files.map(f=>`${currentUser.id}/${f.name}`));
  }

  const {error:uploadError}=await sb.storage.from("avatars").upload(path,selectedAvatarFile,{
    upsert:true,
    contentType:selectedAvatarFile.type,
    cacheControl:"3600"
  });
  if(uploadError)throw uploadError;

  const {data}=sb.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

async function ensureOwnProfile(){
  if(!currentUser)return;
  const display=currentUser.user_metadata?.display_name
    || currentUser.user_metadata?.full_name
    || currentUser.email?.split("@")[0]
    || "Utilisateur";
  const {error}=await sb.rpc("ensure_my_profile",{default_display_name:display});
  if(error)console.warn("Profil:",error.message);
}

async function loadProfile(){
  if(!currentUser){profile=null;isAdmin=false;refreshProfileUI();return}
  const {data,error}=await sb.from("profiles").select("id,display_name,avatar_url,is_admin,access_level").eq("id",currentUser.id).maybeSingle();
  if(error){console.warn(error);return}
  profile=data||null;
  isAdmin=!!profile?.is_admin;
  refreshProfileUI();
  refreshPrivateAccessUI();
}


function hasGendarmerieAccess(){
  return !!currentUser && (isAdmin || profile?.access_level==="gendarme");
}
function refreshPrivateAccessUI(){
  const allowed=hasGendarmerieAccess();
  $("gendarmerieTab")?.classList.toggle("hidden",!allowed);
  if(!allowed && currentStoreTab==="gendarmerie"){
    currentStoreTab="home";
  }
}
function refreshProfileUI(){
  const loggedIn=!!currentUser;
  $("profileLoggedOut").classList.toggle("hidden",loggedIn);
  $("profileForm").classList.toggle("hidden",!loggedIn);
  $("adminBtn").classList.toggle("hidden",!isAdmin);

  if(loggedIn){
    $("profileName").value=profile?.display_name||"";
    setAvatarPreview(profile?.avatar_url||"");
    selectedAvatarFile=null;
    removeAvatarRequested=false;
    $("headerUser").classList.remove("hidden");
    $("headerUserName").textContent=profile?.display_name||currentUser.email||"Utilisateur";
    if(profile?.avatar_url){
      $("headerAvatar").src=profile.avatar_url;
      $("headerAvatar").style.display="";
    }else{
      $("headerAvatar").removeAttribute("src");
      $("headerAvatar").style.display="none";
    }
  }else{
    $("headerUser").classList.add("hidden");
  }
}

async function loadFavoritesFromSupabase(){
  if(!currentUser)return;
  const {data,error}=await sb.from("favorites").select("app_id").eq("user_id",currentUser.id);
  if(error){console.warn(error);return}
  favorites=new Set((data||[]).map(x=>x.app_id));
  localStorage.setItem("romuelapps_favorites",JSON.stringify([...favorites]));
  filter();
}

async function syncFavorite(appId,shouldFavorite){
  if(!currentUser){
    localStorage.setItem("romuelapps_favorites",JSON.stringify([...favorites]));
    return;
  }
  if(shouldFavorite){
    const {error}=await sb.from("favorites").upsert({user_id:currentUser.id,app_id:appId});
    if(error)console.warn(error);
  }else{
    const {error}=await sb.from("favorites").delete().eq("user_id",currentUser.id).eq("app_id",appId);
    if(error)console.warn(error);
  }
}


function openDetails(app,options={}){
  currentApp=app;
  if(!options.skipUrl)setAppUrl(app);
  document.title=`${app.name} — Romuel Apps`;
  $("modalIconWrap").innerHTML=iconHtml(app);
  $("modalTitle").textContent=app.name;
  $("modalMeta").textContent=`Version ${app.version} • Mise à jour le ${fmtDate(app.published)}`;
  $("modalCategory").textContent=app.category||"Autres";
  $("modalNewBadge").classList.toggle("hidden",!isNewApp(app));
  $("modalDescription").textContent=app.description;
  $("modalDownload").href=app.apk;
  $("modalDownloads").textContent=`${Number(app.downloads||0).toLocaleString("fr-FR")} téléchargement${app.downloads===1?"":"s"}`;
  $("favoriteBtn").textContent=favorites.has(app.id)?"♥ Favori":"♡ Favori";
  $("favoriteBtn").classList.toggle("favorite-active",favorites.has(app.id));
  if(app.changes?.length){$("modalChanges").innerHTML=app.changes.map(x=>`<p>• ${esc(x)}</p>`).join("");$("changesBlock").style.display=""}else{$("changesBlock").style.display="none"}
  $("versionsList").innerHTML=(app.versions||[]).map(v=>`
    <div class="version-row">
      <span class="version-pill">v${esc(v.version)}</span>
      <div><div>${esc(fmtDate(v.published))}</div><div class="version-date">${esc((v.changes||[])[0]||"Version publiée")}</div></div>
      <a href="${esc(v.apk)}">APK</a>
    </div>`).join("") || '<div class="empty-state">Aucun historique disponible.</div>';

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
function closeModal(options={}){
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden","true");
  document.body.classList.remove("modal-open");
  currentApp=null;
  document.title="Romuel Apps";
  if(!options.skipUrl)setAppUrl(null);
}

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
async function refreshAuthUI(){
  $("authLoggedOut").classList.toggle("hidden",!!currentUser);
  $("authLoggedIn").classList.toggle("hidden",!currentUser);

  try{
    if(currentUser){
      $("currentUserEmail").textContent=currentUser.email||"Utilisateur connecté";
      await ensureOwnProfile();
      await loadProfile();
      await loadFavoritesFromSupabase();
    }else{
      await loadProfile();
    }
  }catch(err){
    console.warn("Profil/Favoris:",err);
  }

  try{
    if(currentApp)await loadReviewsForCurrentApp();
  }catch(err){
    console.warn("Avis:",err);
  }

  refreshPrivateAccessUI();
}


async function loadPrivateApps(){
  if(!hasGendarmerieAccess()){
    privateApps=[];
    $("privateApps").innerHTML="";
    return;
  }
  const {data,error}=await sb.from("private_apps")
    .select("id,slug,name,version,category,description,apk_path,logo_path,created_at")
    .order("created_at",{ascending:false});
  if(error){
    $("privateApps").innerHTML=`<div class="empty-state">Impossible de charger l’espace privé.</div>`;
    console.warn(error);
    return;
  }
  privateApps=data||[];
  renderPrivateApps();
}

async function signedAsset(path,expires=300){
  if(!path)return "";
  const {data,error}=await sb.storage.from("gendarmerie-apps").createSignedUrl(path,expires);
  if(error)throw error;
  return data.signedUrl;
}

function renderPrivateApps(){
  const box=$("privateApps");
  if(!privateApps.length){
    box.innerHTML='<div class="empty-state">Aucune application privée publiée.</div>';
    return;
  }

  box.innerHTML=privateApps.map(a=>`
    <article class="card private-card">
      <div class="head">
        <div class="fallback">🔒</div>
        <div>
          <h3>${esc(a.name)}</h3>
          <p class="meta">Version ${esc(a.version)}</p>
          <div class="detail-badges"><span class="private-badge">Gendarmerie</span><span class="category-badge">${esc(a.category||"Privé")}</span></div>
        </div>
      </div>
      <p class="desc">${esc(a.description||"Application réservée.")}</p>
      <div class="actions">
        <button class="download" type="button" data-private-download="${esc(a.id)}">Télécharger</button>
      </div>
    </article>
  `).join("");

  // Charger les logos privés avec URL signée.
  privateApps.forEach(async a=>{
    if(!a.logo_path)return;
    try{
      const url=await signedAsset(a.logo_path,300);
      const btn=box.querySelector(`[data-private-download="${CSS.escape(a.id)}"]`);
      const card=btn?.closest(".card");
      const fb=card?.querySelector(".fallback");
      if(fb){
        const img=document.createElement("img");
        img.className="icon";
        img.src=url;
        img.alt=`Logo ${a.name}`;
        fb.replaceWith(img);
      }
    }catch(e){console.warn(e)}
  });
}
async function loadApps(){
  elStatus.className="status";elStatus.textContent="Chargement des applications…";elReload.disabled=true;
  try{
    const c=new AbortController(),t=setTimeout(()=>c.abort(),12000);
    const res=await fetch(API,{headers:{"Accept":"application/vnd.github+json"},cache:"no-store",signal:c.signal});clearTimeout(t);
    if(!res.ok)throw new Error(`GitHub: ${res.status}`);
    apps=parse(await res.json());

    // V11.4 : mettre à jour immédiatement le compteur de l'accueil
    // sans attendre de passer par "Toutes les apps".
    $("appCountHero").textContent=apps.length;

    const cats=[...new Set(apps.map(a=>a.category))].sort((a,b)=>a.localeCompare(b,"fr"));
    $("categoryFilter").innerHTML='<option value="all">Toutes les catégories</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
    elStatus.textContent=apps.length?`${apps.length} application${apps.length>1?"s":""} disponible${apps.length>1?"s":""}.`:"Aucune Release avec un fichier APK n'a été trouvée.";
    refreshStoreView();await loadReviewStats();renderHome();
    if(pendingAppSlug){
      const target=apps.find(a=>a.id===pendingAppSlug);
      if(target)openDetails(target,{skipUrl:true});
      pendingAppSlug=null;
    }
  }catch(e){console.error(e);elStatus.className="status error";elStatus.textContent="Impossible de charger les applications. Vérifie la connexion puis appuie sur « Actualiser ».";elApps.innerHTML=""}
  finally{elReload.disabled=false}
}

window.addEventListener("popstate",()=>{
  const slug=new URLSearchParams(location.search).get("app");
  if(slug){
    const app=apps.find(a=>a.id===slug);
    if(app && currentApp?.id!==slug)openDetails(app,{skipUrl:true});
  }else if(currentApp){
    closeModal({skipUrl:true});
  }
});



// V11.2 — gestion fiable de tous les boutons "Détails"
document.addEventListener("click",e=>{
  const featureBtn=e.target.closest("[data-feature-app]");
  if(featureBtn){
    e.preventDefault();
    const app=apps.find(a=>a.id===featureBtn.dataset.featureApp);
    if(app) openDetails(app);
    return;
  }

  const detailBtn=e.target.closest("[data-details]");
  if(detailBtn){
    e.preventDefault();

    let list=currentFiltered();
    if(currentStoreTab==="favorites"){
      list=list.filter(a=>favorites.has(a.id));
    }

    const app=list[Number(detailBtn.dataset.details)];
    if(app) openDetails(app);
  }
});

modal.addEventListener("click",e=>{if(e.target.matches("[data-close-modal]"))closeModal()});
authModal.addEventListener("click",e=>{if(e.target.matches("[data-close-auth]"))closeAuth()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeModal();closeAuth();closeProfile();closeReport();closeAdmin()}});

$("loginFromReviewBtn").addEventListener("click",openAuth);
$("signInTab").addEventListener("click",()=>setAuthMode("signin"));
$("signUpTab").addEventListener("click",()=>setAuthMode("signup"));

$("authForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const email=$("authEmail").value.trim(),password=$("authPassword").value;
  const msg=$("authMessage");msg.className="form-message";msg.textContent="Traitement…";
  let result;
  if(authMode==="signin")result=await sb.auth.signInWithPassword({email,password});
  else result=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.origin,data:{display_name:email.split("@")[0]}}});
  if(result.error){msg.className="form-message error";msg.textContent=result.error.message;return}
  if(authMode==="signup"&&!result.data.session){msg.className="form-message success";msg.textContent="Compte créé. Vérifie ton e-mail pour confirmer l'inscription.";return}
  msg.className="form-message success";msg.textContent="Connexion réussie.";
  setTimeout(closeAuth,500);
});

$("signOutBtn").addEventListener("click",async()=>{await sb.auth.signOut();closeAuth()});
sb.auth.onAuthStateChange((_event,session)=>{
  currentUser=session?.user||null;

  // IMPORTANT: ne pas lancer d'autres appels Supabase directement
  // dans le callback Auth. On les décale au tour suivant.
  setTimeout(()=>{
    refreshAuthUI().catch(err=>console.warn("Auth UI:",err));
  },0);
});

(async()=>{
  try{
    const {data,error}=await sb.auth.getSession();
    if(error)throw error;
    currentUser=data.session?.user||null;
    await refreshAuthUI();
  }catch(err){
    console.warn("Session:",err);
    currentUser=null;
    await refreshAuthUI();
  }
})();

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

$("favoriteBtn").addEventListener("click",async()=>{
  if(!currentApp)return;
  const shouldFavorite=!favorites.has(currentApp.id);
  if(shouldFavorite)favorites.add(currentApp.id);else favorites.delete(currentApp.id);
  localStorage.setItem("romuelapps_favorites",JSON.stringify([...favorites]));
  await syncFavorite(currentApp.id,shouldFavorite);
  $("favoriteBtn").textContent=favorites.has(currentApp.id)?"♥ Favori":"♡ Favori";
  $("favoriteBtn").classList.toggle("favorite-active",favorites.has(currentApp.id));
  refreshStoreView();
});




function openProfile(){
  $("profileModal").classList.add("show");
  $("profileModal").setAttribute("aria-hidden","false");
  document.body.classList.add("modal-open");
  refreshProfileUI();
}
function closeProfile(){
  $("profileModal").classList.remove("show");
  $("profileModal").setAttribute("aria-hidden","true");
  document.body.classList.remove("modal-open");
}
function openReport(reviewId){
  if(!currentUser){openAuth();return}
  reportedReviewId=reviewId;
  $("reportReason").value="";
  $("reportMessage").textContent="";
  $("reportModal").classList.add("show");
  $("reportModal").setAttribute("aria-hidden","false");
  document.body.classList.add("modal-open");
}
function closeReport(){
  $("reportModal").classList.remove("show");
  $("reportModal").setAttribute("aria-hidden","true");
  document.body.classList.remove("modal-open");
  reportedReviewId=null;
}
async function loadAdminReports(){
  if(!isAdmin)return;
  const {data,error}=await sb.from("review_reports")
    .select("id,reason,status,created_at,review_id,reporter_id,reviews(id,app_id,user_id,user_name,rating,comment,moderation_status,created_at)")
    .eq("status","pending")
    .order("created_at",{ascending:false});
  const box=$("adminReports");
  if(error){box.innerHTML=`<p class="form-message error">${esc(error.message)}</p>`;return}
  const rows=data||[];
  box.innerHTML=rows.length?rows.map(x=>{
    const r=x.reviews||{};
    return `<article class="admin-report-card">
      <h3>${esc(r.user_name||"Utilisateur")} • ${esc(r.app_id||"")}</h3>
      <div class="admin-report-meta">${esc(fmtDate(x.created_at))} • Signalement #${x.id}</div>
      <p class="review-comment">${esc(r.comment||"Avis indisponible")}</p>
      <div class="admin-report-reason"><strong>Motif :</strong> ${esc(x.reason)}</div>
      <div class="admin-actions">
        <button type="button" class="success" data-admin-action="dismiss" data-report-id="${x.id}">Rejeter le signalement</button>
        <button type="button" data-admin-action="hide" data-report-id="${x.id}" data-review-id="${r.id||""}">Masquer l’avis</button>
        <button type="button" class="danger" data-admin-action="delete" data-report-id="${x.id}" data-review-id="${r.id||""}">Supprimer l’avis</button>
      </div>
    </article>`;
  }).join(""):'<p class="form-message">Aucun signalement en attente.</p>';
}

async function loadAdminDashboard(){
  if(!isAdmin)return;

  const totalGithub=apps.reduce((sum,a)=>sum+Number(a.downloads||0),0);
  $("adminAppsCount").textContent=apps.length;
  $("adminGithubDownloads").textContent=totalGithub.toLocaleString("fr-FR");

  const now=new Date();
  const startToday=new Date(now); startToday.setHours(0,0,0,0);
  const weekAgo=new Date(now.getTime()-7*24*60*60*1000);

  const [
    {count:todayClicks},
    {count:weekClicks},
    {count:reviewsCount},
    {count:usersCount},
    {data:trackedRows}
  ]=await Promise.all([
    sb.from("download_events").select("*",{count:"exact",head:true}).gte("created_at",startToday.toISOString()),
    sb.from("download_events").select("*",{count:"exact",head:true}).gte("created_at",weekAgo.toISOString()),
    sb.from("reviews").select("*",{count:"exact",head:true}),
    sb.from("profiles").select("*",{count:"exact",head:true}),
    sb.from("download_events").select("app_id").gte("created_at",weekAgo.toISOString())
  ]);

  $("adminTodayClicks").textContent=Number(todayClicks||0).toLocaleString("fr-FR");
  $("adminWeekClicks").textContent=Number(weekClicks||0).toLocaleString("fr-FR");
  $("adminReviewsCount").textContent=Number(reviewsCount||0).toLocaleString("fr-FR");
  $("adminUsersCount").textContent=Number(usersCount||0).toLocaleString("fr-FR");

  const tracked={};
  for(const row of trackedRows||[])tracked[row.app_id]=(tracked[row.app_id]||0)+1;

  $("adminAppsStats").innerHTML=apps.length?apps.map(app=>{
    const st=reviewStats[app.id]||{avg:0,count:0};
    return `<div class="admin-app-row">
      <div class="app-name">${esc(app.name)}</div>
      <div class="mini-stat">⬇ ${Number(app.downloads||0).toLocaleString("fr-FR")} GitHub</div>
      <div class="mini-stat">7j : ${Number(tracked[app.id]||0).toLocaleString("fr-FR")} clics</div>
      <div class="mini-stat">★ ${st.count?st.avg.toFixed(1):"—"} • ${st.count} avis</div>
    </div>`;
  }).join(""):'<p class="form-message">Aucune application.</p>';
}

function openAdmin(){
  if(!isAdmin)return;
  $("adminModal").classList.add("show");
  $("adminModal").setAttribute("aria-hidden","false");
  document.body.classList.add("modal-open");
  loadAdminReports();
  loadAdminDashboard();
}
function closeAdmin(){
  $("adminModal").classList.remove("show");
  $("adminModal").setAttribute("aria-hidden","true");
  document.body.classList.remove("modal-open");
}

$("profileBtn").addEventListener("click",openProfile);
$("profileLoginBtn").addEventListener("click",()=>{closeProfile();openAuth()});
$("profileSignOutBtn").addEventListener("click",async()=>{await sb.auth.signOut();closeProfile()});
$("adminBtn").addEventListener("click",openAdmin);

$("profileModal").addEventListener("click",e=>{if(e.target.matches("[data-close-profile]"))closeProfile()});
$("reportModal").addEventListener("click",e=>{if(e.target.matches("[data-close-report]"))closeReport()});
$("adminModal").addEventListener("click",e=>{if(e.target.matches("[data-close-admin]"))closeAdmin()});

$("profileForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!currentUser)return;

  const display_name=$("profileName").value.trim();
  const msg=$("profileMessage");
  msg.className="form-message";
  msg.textContent="Enregistrement…";

  try{
    const avatar_url=await uploadAvatarIfNeeded();

    // On met à jour uniquement les colonnes autorisées par Supabase.
    const {error}=await sb.from("profiles")
      .update({display_name,avatar_url})
      .eq("id",currentUser.id);

    if(error)throw error;

    selectedAvatarFile=null;
    removeAvatarRequested=false;
    msg.className="form-message success";
    msg.textContent="Profil enregistré.";
    await loadProfile();
  }catch(error){
    msg.className="form-message error";
    msg.textContent=error.message||"Impossible d’enregistrer le profil.";
  }
});

$("profileAvatarFile").addEventListener("change",e=>{
  const file=e.target.files?.[0];
  if(!file)return;

  if(!["image/png","image/jpeg","image/webp"].includes(file.type)){
    $("profileMessage").className="form-message error";
    $("profileMessage").textContent="Choisis une image PNG, JPG ou WebP.";
    e.target.value="";
    return;
  }

  if(file.size>5*1024*1024){
    $("profileMessage").className="form-message error";
    $("profileMessage").textContent="La photo ne doit pas dépasser 5 Mo.";
    e.target.value="";
    return;
  }

  selectedAvatarFile=file;
  removeAvatarRequested=false;
  setAvatarPreview(URL.createObjectURL(file));
  $("profileMessage").textContent="";
});

$("removeAvatarBtn").addEventListener("click",()=>{
  selectedAvatarFile=null;
  removeAvatarRequested=true;
  $("profileAvatarFile").value="";
  setAvatarPreview("");
  $("profileMessage").className="form-message";
  $("profileMessage").textContent="La photo sera supprimée après Enregistrer mon profil.";
});

$("reviewsList").addEventListener("click",e=>{
  const btn=e.target.closest("[data-report-review]");
  if(btn)openReport(Number(btn.dataset.reportReview));
});

$("reportForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!currentUser||!reportedReviewId)return;
  const reason=$("reportReason").value.trim();
  const msg=$("reportMessage");msg.className="form-message";msg.textContent="Envoi…";
  const {error}=await sb.from("review_reports").insert({review_id:reportedReviewId,reporter_id:currentUser.id,reason});
  if(error){
    msg.className="form-message error";
    msg.textContent=error.code==="23505"?"Tu as déjà signalé cet avis.":error.message;
    return;
  }
  msg.className="form-message success";msg.textContent="Signalement envoyé.";
  setTimeout(closeReport,700);
});

$("adminReports").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-admin-action]"); if(!btn)return;
  const action=btn.dataset.adminAction,reportId=Number(btn.dataset.reportId),reviewId=Number(btn.dataset.reviewId);
  if(action==="dismiss"){
    await sb.from("review_reports").update({status:"dismissed"}).eq("id",reportId);
  }else if(action==="hide"){
    if(reviewId)await sb.from("reviews").update({moderation_status:"hidden"}).eq("id",reviewId);
    await sb.from("review_reports").update({status:"reviewed"}).eq("id",reportId);
  }else if(action==="delete"){
    if(reviewId)await sb.from("reviews").delete().eq("id",reviewId);
    await sb.from("review_reports").update({status:"reviewed"}).eq("id",reportId);
  }
  await loadAdminReports();
  if(currentApp){await loadReviewsForCurrentApp();await loadReviewStats()}
});


document.addEventListener("click",async e=>{
  const btn=e.target.closest("[data-private-download]");
  if(!btn)return;
  if(!hasGendarmerieAccess()){
    alert("Accès réservé.");
    return;
  }
  const app=privateApps.find(x=>String(x.id)===btn.dataset.privateDownload);
  if(!app)return;
  btn.disabled=true;
  const old=btn.textContent;
  btn.textContent="Préparation…";
  try{
    const url=await signedAsset(app.apk_path,120);
    location.href=url;
  }catch(err){
    alert("Téléchargement impossible.");
    console.warn(err);
  }finally{
    btn.disabled=false;
    btn.textContent=old;
  }
});

async function loadAdminUsersAccess(){
  if(!isAdmin)return;

  const box=$("adminUsersAccess");
  box.innerHTML='<p class="form-message">Chargement des comptes…</p>';

  try{
    const {data,error}=await sb.rpc("admin_list_users");
    if(error)throw error;

    const rows=Array.isArray(data)?data:[];
    if(!rows.length){
      box.innerHTML='<p class="form-message">Aucun utilisateur trouvé.</p>';
      return;
    }

    box.innerHTML=rows.map(u=>{
      const access=u.is_admin ? "admin" : (u.access_level||"public");
      const label=u.is_admin ? "Admin" : access==="gendarme" ? "Gendarme" : "Public";
      const button=u.is_admin
        ? ''
        : `<button class="secondary-btn" type="button"
              data-set-access="${esc(u.id)}"
              data-next-access="${access==="gendarme"?"public":"gendarme"}">
              ${access==="gendarme"?"Retirer accès":"Autoriser Gendarmerie"}
           </button>`;

      return `<div class="user-access-row">
        <div>
          <strong>${esc(u.display_name||"Utilisateur")}</strong>
          <div class="user-id">${esc(u.email||"")}</div>
        </div>
        <span class="access-pill">${label}</span>
        ${button}
      </div>`;
    }).join("");
  }catch(err){
    console.error("admin_list_users:",err);
    box.innerHTML=`<p class="form-message error">Impossible de charger les comptes : ${esc(err.message||String(err))}</p>`;
  }
}

$("refreshAdminUsersBtn")?.addEventListener("click",loadAdminUsersAccess);

$("adminUsersAccess").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-set-access]");
  if(!btn)return;
  const userId=btn.dataset.setAccess,next=btn.dataset.nextAccess;
  btn.disabled=true;
  const {error}=await sb.rpc("set_user_access",{target_user:userId,new_access:next});
  if(error){
    alert(error.message);
    btn.disabled=false;
    return;
  }

  await loadAdminUsersAccess();

  if(currentUser?.id===userId){
    await loadProfile();
    refreshPrivateAccessUI();
  }
});

$("privateAppForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!isAdmin)return;
  const msg=$("privateAppMessage");
  msg.className="form-message";
  msg.textContent="Publication…";

  try{
    const name=$("privateAppName").value.trim();
    const version=$("privateAppVersion").value.trim();
    const category=$("privateAppCategory").value.trim()||"Privé";
    const description=$("privateAppDescription").value.trim();
    const apk=$("privateAppApk").files?.[0];
    const logo=$("privateAppLogo").files?.[0];
    if(!apk)throw new Error("Choisis un APK.");

    const slug=slugify(name);
    const base=`${slug}/${Date.now()}`;
    const apkPath=`${base}/${apk.name}`;

    const upApk=await sb.storage.from("gendarmerie-apps").upload(apkPath,apk,{upsert:false,contentType:apk.type||"application/vnd.android.package-archive"});
    if(upApk.error)throw upApk.error;

    let logoPath=null;
    if(logo){
      logoPath=`${base}/${logo.name}`;
      const upLogo=await sb.storage.from("gendarmerie-apps").upload(logoPath,logo,{upsert:false,contentType:logo.type});
      if(upLogo.error)throw upLogo.error;
    }

    const ins=await sb.from("private_apps").insert({slug,name,version,category,description,apk_path:apkPath,logo_path:logoPath,created_by:currentUser.id});
    if(ins.error)throw ins.error;

    msg.className="form-message success";
    msg.textContent="Application privée publiée.";
    e.target.reset();
    await loadPrivateApps();
  }catch(err){
    msg.className="form-message error";
    msg.textContent=err.message||"Publication impossible.";
  }
});
$("shareBtn").addEventListener("click",async()=>{
  if(!currentApp)return;
  const url=appPageUrl(currentApp);
  const data={title:`${currentApp.name} — Romuel Apps`,text:`Découvre ${currentApp.name} sur Romuel Apps`,url};
  try{
    if(navigator.share)await navigator.share(data);
    else{await navigator.clipboard.writeText(url);alert("Lien de l’application copié.")}
  }catch{}
});
$("themeBtn").addEventListener("click",()=>{document.body.classList.toggle("light");$("themeBtn").textContent=document.body.classList.contains("light")?"☀":"☾"});
document.addEventListener("click",async e=>{
  const a=e.target.closest("a.download, #modalDownload");
  if(!a)return;
  const app=currentApp || apps.find(x=>x.apk===a.href || x.apk===a.getAttribute("href"));
  if(app)trackDownload(app);
});

document.querySelectorAll("[data-go-all]").forEach(btn=>btn.addEventListener("click",()=>{
  currentStoreTab="all";
  refreshStoreView();
  document.querySelector(".store-tabs")?.scrollIntoView({behavior:"smooth",block:"start"});
}));

document.querySelectorAll(".store-tab").forEach(btn=>btn.addEventListener("click",()=>{
  currentStoreTab=btn.dataset.storeTab;
  refreshStoreView();
}));
$("categoryFilter").addEventListener("change",()=>{
  if(currentStoreTab==="home")currentStoreTab="all";
  refreshStoreView();
});
elQ.addEventListener("input",()=>{
  if(elQ.value.trim() && currentStoreTab==="home")currentStoreTab="all";
  refreshStoreView();
});
elReload.addEventListener("click",loadApps);
loadApps();
