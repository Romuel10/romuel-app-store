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
let publisherApps=[],publisherScreens=[],publisherAvailable=true,isPublisherSubmitting=false;
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
const linesToArray=s=>String(s||"").split(/\r?\n/).map(x=>x.trim().replace(/^[-*•]\s*/,"")).filter(Boolean);
const makeId=()=>crypto.randomUUID?crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==="x"?r:(r&3|8);return v.toString(16)});
const safeFileName=name=>String(name||"fichier").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"")||"fichier";
const isMissingPublisherSchema=error=>["42P01","PGRST205","PGRST200"].includes(error?.code)||/applications|app_versions|app_screenshots/i.test(error?.message||"")&&/not find|does not exist|schema cache|relation/i.test(error?.message||"");

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
      recordId:null,
      source:"github",
      visibility:"public",
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
      source:"github",
      published:v.published,
      changes:v.changes
    }));
    out.push(latest);
  }
  return out;
}

async function signedUrlMap(bucket,paths,expires=3600){
  const unique=[...new Set((paths||[]).filter(Boolean))];
  const map=new Map();
  if(!unique.length)return map;
  const {data,error}=await sb.storage.from(bucket).createSignedUrls(unique,expires);
  if(error){
    console.warn(`URLs signées ${bucket}:`,error.message);
    return map;
  }
  (data||[]).forEach((row,index)=>{
    if(row?.signedUrl)map.set(row.path||unique[index],row.signedUrl);
  });
  return map;
}

function normalizePublisherApp(row,iconUrls,screenUrls){
  const screenshots=[...(row.app_screenshots||[])]
    .sort((a,b)=>(a.sort_order||0)-(b.sort_order||0))
    .map(x=>screenUrls.get(x.storage_path))
    .filter(Boolean);
  const versions=[...(row.app_versions||[])]
    .sort((a,b)=>new Date(b.published_at)-new Date(a.published_at))
    .map(v=>({
      id:v.id,
      version:v.version,
      apkPath:v.apk_path,
      apkBucket:"app-apk",
      source:"supabase",
      published:v.published_at,
      changes:Array.isArray(v.changes)?v.changes:[]
    }));

  if(!versions.some(v=>v.version===row.version)){
    versions.unshift({
      version:row.version,
      apkPath:row.apk_path,
      apkBucket:"app-apk",
      source:"supabase",
      published:row.updated_at||row.published_at,
      changes:Array.isArray(row.changes)?row.changes:[]
    });
  }

  return {
    id:row.slug,
    recordId:row.id,
    source:"supabase",
    visibility:row.visibility,
    status:row.status,
    name:row.name,
    version:row.version||"—",
    category:row.category||"Autres",
    description:row.description||"Application Android disponible au téléchargement.",
    changes:Array.isArray(row.changes)?row.changes:[],
    apk:"#",
    apkPath:row.apk_path,
    apkBucket:"app-apk",
    downloads:Number(row.download_count||0),
    icon:iconUrls.get(row.icon_path)||"",
    iconPath:row.icon_path||null,
    screenshots,
    published:row.updated_at||row.published_at||row.created_at,
    versions
  };
}

async function fetchPublisherCatalog(visibility){
  const {data,error}=await sb.from("applications")
    .select("id,slug,name,version,category,description,changes,visibility,status,icon_path,apk_path,download_count,published_at,updated_at,created_at,app_versions(id,version,apk_path,changes,published_at),app_screenshots(id,storage_path,alt_text,sort_order)")
    .eq("visibility",visibility)
    .eq("status","published")
    .order("updated_at",{ascending:false});

  if(error){
    if(isMissingPublisherSchema(error)){
      publisherAvailable=false;
      return [];
    }
    throw error;
  }

  publisherAvailable=true;
  const rows=data||[];
  const assetLifetime=visibility==="gendarmerie"?300:3600;
  const iconUrls=await signedUrlMap("app-icons",rows.map(x=>x.icon_path),assetLifetime);
  const screenUrls=await signedUrlMap("app-screenshots",rows.flatMap(x=>(x.app_screenshots||[]).map(s=>s.storage_path)),assetLifetime);
  return rows.map(row=>normalizePublisherApp(row,iconUrls,screenUrls));
}

function iconHtml(a){const n=esc(a.name),ini=esc(initials(a.name));return a.icon?`<img class="icon" src="${esc(a.icon)}" alt="Logo ${n}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="fallback" style="display:none">${ini}</div>`:`<div class="fallback">${ini}</div>`}
function downloadHtml(a,label="Télécharger"){
  if(a.apkPath){
    return `<button class="download" type="button" data-secure-download="${esc(a.id)}" data-apk-path="${esc(a.apkPath)}" data-apk-bucket="${esc(a.apkBucket||"app-apk")}">${esc(label)}</button>`;
  }
  return `<a class="download" href="${esc(a.apk)}">${esc(label)}</a>`;
}
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
      <div class="actions">${downloadHtml(a)}<button class="details" type="button" data-details="${i}">Détails</button></div>
    </article>`;
  }).join("");
}

function featureCard(a){
  const st=reviewStats[a.id]||{avg:0,count:0};
  return `<article class="feature-card">
    <div class="head">${iconHtml(a)}<div><h4>${esc(a.name)}</h4><p class="meta">Version ${esc(a.version)}</p><span class="category-badge">${esc(a.category)}</span></div></div>
    <div class="rating-mini"><span class="stars">${starsFrom(st.avg)}</span><span>${st.count?`${st.avg.toFixed(1)} (${st.count})`:"Aucun avis"}</span></div>
    <p class="desc">${esc(a.description)}</p>
    <div class="feature-actions">${downloadHtml(a)}<button class="details" data-feature-app="${esc(a.id)}" type="button">Détails</button></div>
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
  if(!allowed){
    privateApps=[];
    if(currentApp?.visibility==="gendarmerie")closeModal();
    if(currentStoreTab==="gendarmerie"){
      currentStoreTab="home";
      refreshStoreView();
    }
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

function versionDownloadHtml(app,version){
  if(version.apkPath){
    return `<button class="version-download" type="button" data-secure-download="${esc(app.id)}" data-apk-path="${esc(version.apkPath)}" data-apk-bucket="${esc(version.apkBucket||app.apkBucket||"app-apk")}">APK</button>`;
  }
  return `<a href="${esc(version.apk||app.apk)}">APK</a>`;
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
  const modalDownload=$("modalDownload");
  if(app.apkPath){
    modalDownload.href="#";
    modalDownload.dataset.secureDownload=app.id;
    modalDownload.dataset.apkPath=app.apkPath;
    modalDownload.dataset.apkBucket=app.apkBucket||"app-apk";
  }else{
    modalDownload.href=app.apk;
    delete modalDownload.dataset.secureDownload;
    delete modalDownload.dataset.apkPath;
    delete modalDownload.dataset.apkBucket;
  }
  $("modalDownloads").textContent=`${Number(app.downloads||0).toLocaleString("fr-FR")} téléchargement${app.downloads===1?"":"s"}`;
  $("favoriteBtn").textContent=favorites.has(app.id)?"♥ Favori":"♡ Favori";
  $("favoriteBtn").classList.toggle("favorite-active",favorites.has(app.id));
  if(app.changes?.length){$("modalChanges").innerHTML=app.changes.map(x=>`<p>• ${esc(x)}</p>`).join("");$("changesBlock").style.display=""}else{$("changesBlock").style.display="none"}
  $("versionsList").innerHTML=(app.versions||[]).map(v=>`
    <div class="version-row">
      <span class="version-pill">v${esc(v.version)}</span>
      <div><div>${esc(fmtDate(v.published))}</div><div class="version-date">${esc((v.changes||[])[0]||"Version publiée")}</div></div>
      ${versionDownloadHtml(app,v)}
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
  if(hasGendarmerieAccess()&&(currentStoreTab==="gendarmerie"||pendingAppSlug)){
    loadPrivateApps().catch(err=>console.warn("Espace Gendarmerie:",err));
  }
}


async function loadPrivateApps(){
  if(!hasGendarmerieAccess()){
    privateApps=[];
    $("privateApps").innerHTML="";
    return;
  }
  $("privateApps").innerHTML='<div class="empty-state">Chargement de l’espace protégé…</div>';

  const [publisherResult,legacyResult]=await Promise.allSettled([
    fetchPublisherCatalog("gendarmerie"),
    loadLegacyPrivateApps()
  ]);
  const modern=publisherResult.status==="fulfilled"?publisherResult.value:[];
  const legacy=legacyResult.status==="fulfilled"?legacyResult.value:[];
  if(publisherResult.status==="rejected")console.warn("Catalogue Gendarmerie:",publisherResult.reason);
  if(legacyResult.status==="rejected")console.warn("Anciennes apps Gendarmerie:",legacyResult.reason);

  const modernSlugs=new Set(modern.map(x=>x.id));
  privateApps=[...modern,...legacy.filter(x=>!modernSlugs.has(x.id))];
  renderPrivateApps();

  if(pendingAppSlug){
    const target=privateApps.find(a=>a.id===pendingAppSlug);
    if(target){openDetails(target,{skipUrl:true});pendingAppSlug=null}
  }
}

async function loadLegacyPrivateApps(){
  const {data,error}=await sb.from("private_apps")
    .select("id,slug,name,version,category,description,apk_path,logo_path,created_at")
    .order("created_at",{ascending:false});
  if(error){
    if(["42P01","PGRST205"].includes(error.code))return [];
    throw error;
  }
  const rows=data||[];
  const iconUrls=await signedUrlMap("gendarmerie-apps",rows.map(x=>x.logo_path),300);
  return rows.map(row=>({
    id:row.slug||String(row.id),
    recordId:null,
    source:"supabase-legacy",
    visibility:"gendarmerie",
    status:"published",
    name:row.name,
    version:row.version||"—",
    category:row.category||"Privé",
    description:row.description||"Application réservée.",
    changes:[],
    apk:"#",
    apkPath:row.apk_path,
    apkBucket:"gendarmerie-apps",
    downloads:0,
    icon:iconUrls.get(row.logo_path)||"",
    screenshots:[],
    published:row.created_at,
    versions:[{version:row.version||"—",apkPath:row.apk_path,apkBucket:"gendarmerie-apps",source:"supabase",published:row.created_at,changes:[]}]
  }));
}

function renderPrivateApps(){
  const box=$("privateApps");
  if(!privateApps.length){
    box.innerHTML='<div class="empty-state">Aucune application Gendarmerie publiée.</div>';
    return;
  }

  box.innerHTML=privateApps.map(a=>`
    <article class="card private-card">
      <div class="head">${iconHtml(a)}<div>
          <h3>${esc(a.name)}</h3>
          <p class="meta">Version ${esc(a.version)}</p>
          <div class="detail-badges"><span class="private-badge">Gendarmerie</span><span class="category-badge">${esc(a.category||"Privé")}</span></div>
        </div></div>
      <p class="desc">${esc(a.description||"Application réservée.")}</p>
      <div class="actions">
        ${downloadHtml(a)}
        <button class="details" type="button" data-private-details="${esc(a.id)}">Détails</button>
      </div>
    </article>
  `).join("");
}

async function fetchGithubApps(){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const res=await fetch(API,{headers:{"Accept":"application/vnd.github+json"},cache:"no-store",signal:controller.signal});
    if(!res.ok)throw new Error(`GitHub: ${res.status}`);
    return parse(await res.json());
  }finally{
    clearTimeout(timeout);
  }
}

async function loadApps(){
  elStatus.className="status";elStatus.textContent="Chargement des applications…";elReload.disabled=true;
  try{
    const [publisherResult,githubResult]=await Promise.allSettled([
      fetchPublisherCatalog("public"),
      fetchGithubApps()
    ]);
    const published=publisherResult.status==="fulfilled"?publisherResult.value:[];
    const legacy=githubResult.status==="fulfilled"?githubResult.value:[];
    if(publisherResult.status==="rejected")console.warn("Catalogue Supabase:",publisherResult.reason);
    if(githubResult.status==="rejected")console.warn("Catalogue GitHub:",githubResult.reason);
    if(publisherResult.status==="rejected"&&githubResult.status==="rejected")throw new Error("Aucune source disponible");

    // Une application créée dans Supabase remplace automatiquement l’ancienne
    // publication GitHub qui porte le même identifiant.
    const publisherSlugs=new Set(published.map(x=>x.id));
    apps=[...published,...legacy.filter(x=>!publisherSlugs.has(x.id))];

    // V11.4 : mettre à jour immédiatement le compteur de l'accueil
    // sans attendre de passer par "Toutes les apps".
    $("appCountHero").textContent=apps.length;

    const cats=[...new Set(apps.map(a=>a.category))].sort((a,b)=>a.localeCompare(b,"fr"));
    $("categoryFilter").innerHTML='<option value="all">Toutes les catégories</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
    elStatus.textContent=apps.length?`${apps.length} application${apps.length>1?"s":""} disponible${apps.length>1?"s":""}.`:"Aucune application publiée pour le moment.";
    refreshStoreView();await loadReviewStats();renderHome();
    if(pendingAppSlug){
      const target=apps.find(a=>a.id===pendingAppSlug);
      if(target){openDetails(target,{skipUrl:true});pendingAppSlug=null}
    }
  }catch(e){console.error(e);elStatus.className="status error";elStatus.textContent="Impossible de charger les applications. Vérifie la connexion puis appuie sur « Actualiser ».";elApps.innerHTML=""}
  finally{elReload.disabled=false}
}

window.addEventListener("popstate",()=>{
  const slug=new URLSearchParams(location.search).get("app");
  if(slug){
    const app=[...apps,...privateApps].find(a=>a.id===slug);
    if(app && currentApp?.id!==slug)openDetails(app,{skipUrl:true});
  }else if(currentApp){
    closeModal({skipUrl:true});
  }
});



// V11.2 — gestion fiable de tous les boutons "Détails"
document.addEventListener("click",e=>{
  const privateBtn=e.target.closest("[data-private-details]");
  if(privateBtn){
    e.preventDefault();
    const app=privateApps.find(a=>a.id===privateBtn.dataset.privateDetails);
    if(app)openDetails(app);
    return;
  }

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

  const adminCatalog=[...apps];
  for(const row of publisherApps){
    if(!adminCatalog.some(app=>app.recordId===row.id||app.id===row.slug)){
      adminCatalog.push({id:row.slug,name:row.name,version:row.version,downloads:Number(row.download_count||0),visibility:row.visibility,status:row.status});
    }
  }
  const totalDownloads=adminCatalog.reduce((sum,a)=>sum+Number(a.downloads||0),0);
  $("adminAppsCount").textContent=adminCatalog.length;
  $("adminGithubDownloads").textContent=totalDownloads.toLocaleString("fr-FR");

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

  $("adminAppsStats").innerHTML=adminCatalog.length?adminCatalog.map(app=>{
    const st=reviewStats[app.id]||{avg:0,count:0};
    return `<div class="admin-app-row">
      <div class="app-name">${esc(app.name)}${app.visibility==="gendarmerie"?' <span class="private-badge">Gendarmerie</span>':""}${app.status==="draft"?' <span class="publisher-pill draft">Brouillon</span>':""}</div>
      <div class="mini-stat">⬇ ${Number(app.downloads||0).toLocaleString("fr-FR")}</div>
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
  loadAdminPublisher().then(loadAdminDashboard);
  loadAdminUsersAccess();
}
function closeAdmin(){
  if(isPublisherSubmitting)return;
  $("adminModal").classList.remove("show");
  $("adminModal").setAttribute("aria-hidden","true");
  document.body.classList.remove("modal-open");
  closePublisherForm();
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
  const btn=e.target.closest("[data-secure-download]");
  if(!btn)return;
  e.preventDefault();
  const app=[...apps,...privateApps].find(x=>x.id===btn.dataset.secureDownload)||currentApp;
  if(app?.visibility==="gendarmerie"&&!hasGendarmerieAccess()){
    alert("Accès réservé.");
    return;
  }
  const path=btn.dataset.apkPath;
  const bucket=btn.dataset.apkBucket||"app-apk";
  if(!path)return;
  btn.disabled=true;
  const old=btn.textContent;
  btn.textContent="Préparation…";
  try{
    const {data,error}=await sb.storage.from(bucket).createSignedUrl(path,120);
    if(error)throw error;
    if(app)await trackDownload(app);
    const url=data.signedUrl;
    location.href=url;
  }catch(err){
    alert(err?.statusCode===403?"Tu n’es pas autorisé à télécharger cette application.":"Téléchargement impossible.");
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

function publisherRowById(id){
  return publisherApps.find(x=>x.id===id);
}

function renderLegacyPublisherApps(){
  const legacy=apps.filter(x=>x.source==="github");
  $("legacyAppsBlock").classList.toggle("hidden",!legacy.length);
  $("legacyAppsList").innerHTML=legacy.map(app=>`
    <div class="publisher-app-row">
      <div class="publisher-app-main">
        <strong>${esc(app.name)}</strong>
        <small>Version ${esc(app.version)} • publication GitHub</small>
      </div>
      <div class="publisher-row-actions">
        <button type="button" data-import-legacy="${esc(app.id)}">Recréer ici</button>
      </div>
    </div>`).join("");
}

function renderPublisherApps(){
  const box=$("publisherAppList");
  if(!publisherAvailable){
    box.innerHTML='<div class="publisher-empty publisher-schema-error">Le centre de publication doit d’abord être activé dans Supabase.</div>';
    renderLegacyPublisherApps();
    return;
  }
  if(!publisherApps.length){
    box.innerHTML='<div class="publisher-empty">Aucune application Supabase. Utilise « Nouvelle application » pour commencer.</div>';
  }else{
    box.innerHTML=publisherApps.map(app=>{
      const access=app.visibility==="gendarmerie"?"Gendarmerie":"Publique";
      const state=app.status==="published"?"Publiée":"Brouillon";
      return `<div class="publisher-app-row">
        <div class="publisher-app-main">
          <strong>${esc(app.name)}</strong>
          <small>Version ${esc(app.version||"—")} • ${esc(app.category||"Autres")}</small>
          <div class="publisher-app-badges">
            <span class="publisher-pill ${esc(app.visibility)}">${access}</span>
            <span class="publisher-pill ${esc(app.status)}">${state}</span>
          </div>
        </div>
        <div class="publisher-row-actions">
          <button type="button" data-publisher-edit="${esc(app.id)}">Configurer</button>
          <button type="button" data-publisher-update="${esc(app.id)}">＋ Mise à jour</button>
          <button type="button" data-publisher-toggle="${esc(app.id)}" data-next-status="${app.status==="published"?"draft":"published"}">${app.status==="published"?"Masquer":"Publier"}</button>
        </div>
      </div>`;
    }).join("");
  }
  renderLegacyPublisherApps();
}

async function loadAdminPublisher(){
  if(!isAdmin)return;
  const box=$("publisherAppList");
  box.innerHTML='<p class="form-message">Chargement des applications…</p>';
  const {data,error}=await sb.from("applications")
    .select("id,slug,name,version,category,description,changes,visibility,status,icon_path,apk_path,download_count,published_at,updated_at,created_at,app_versions(id,version,apk_path,changes,published_at),app_screenshots(id,storage_path,alt_text,sort_order)")
    .order("updated_at",{ascending:false});

  if(error){
    const schemaMissing=isMissingPublisherSchema(error);
    publisherAvailable=false;
    if(schemaMissing){
      $("publisherSetupNotice").classList.remove("hidden");
      $("publisherSetupNotice").innerHTML='Exécute le fichier <code>supabase-v13-publisher.sql</code> dans l’éditeur SQL de Supabase. Il crée les tables, les stockages privés et les règles de sécurité.';
    }else{
      $("publisherSetupNotice").classList.remove("hidden");
      $("publisherSetupNotice").textContent=`Impossible de charger le centre de publication : ${error.message}`;
    }
    publisherApps=[];
    renderPublisherApps();
    return;
  }

  publisherAvailable=true;
  $("publisherSetupNotice").classList.add("hidden");
  publisherApps=data||[];
  renderPublisherApps();
}

function resetPublisherMessage(){
  $("publisherMessage").className="form-message";
  $("publisherMessage").textContent="";
  $("publisherProgressWrap").classList.add("hidden");
  $("publisherProgressBar").style.width="0%";
}

async function showPublisherScreens(app){
  publisherScreens=[...(app?.app_screenshots||[])].filter(x=>x.storage_path).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  const wrap=$("publisherExistingScreens");
  if(!publisherScreens.length){wrap.innerHTML="";wrap.classList.add("hidden");return}
  const urls=await signedUrlMap("app-screenshots",publisherScreens.map(x=>x.storage_path),1200);
  wrap.innerHTML=publisherScreens.map((screen,index)=>`
    <div class="publisher-screen-item">
      <img src="${esc(urls.get(screen.storage_path)||"")}" alt="Capture ${index+1}">
      <button type="button" data-delete-publisher-screen="${esc(screen.id)}" data-screen-path="${esc(screen.storage_path)}" aria-label="Supprimer cette capture">×</button>
    </div>`).join("");
  wrap.classList.remove("hidden");
}

function openPublisherForm(mode,app=null){
  if(!publisherAvailable){
    $("publisherSetupNotice").classList.remove("hidden");
    $("publisherSetupNotice").innerHTML='Active d’abord le centre avec <code>supabase-v13-publisher.sql</code>.';
    return;
  }
  const form=$("publisherForm");
  form.reset();
  resetPublisherMessage();
  form.classList.remove("hidden");
  form.closest(".publisher-layout")?.classList.remove("publisher-form-closed");
  $("publisherMode").value=mode;
  $("publisherAppId").value=app?.id||"";
  $("publisherMetadataFields").classList.toggle("hidden",mode==="update");
  $("publisherVersionFields").classList.toggle("hidden",mode==="edit");
  $("publisherMetadataFields").disabled=mode==="update";
  $("publisherVersionFields").disabled=mode==="edit";
  $("publisherSlug").readOnly=mode==="edit";
  $("publisherSlug").dataset.auto=mode==="create"?"true":"false";
  $("publisherVersion").required=mode!=="edit";
  $("publisherApk").required=mode!=="edit";
  $("publisherVersionLegend").textContent=mode==="update"?"Nouvelle version":"Première version";

  if(mode==="create"){
    $("publisherFormEyebrow").textContent="NOUVELLE APPLICATION";
    $("publisherFormTitle").textContent="Créer une application";
    $("publisherSubmitBtn").textContent="Publier l’application";
    $("publisherStatus").value="published";
    $("publisherVisibility").value="public";
    showPublisherScreens(null);
  }else if(mode==="edit"){
    $("publisherFormEyebrow").textContent="CONFIGURATION";
    $("publisherFormTitle").textContent=app.name;
    $("publisherSubmitBtn").textContent="Enregistrer les modifications";
    $("publisherName").value=app.name||"";
    $("publisherSlug").value=app.slug||"";
    $("publisherCategory").value=app.category||"Autres";
    $("publisherVisibility").value=app.visibility||"public";
    $("publisherStatus").value=app.status||"draft";
    $("publisherDescription").value=app.description||"";
    showPublisherScreens(app);
  }else{
    $("publisherFormEyebrow").textContent="MISE À JOUR";
    $("publisherFormTitle").textContent=app.name;
    $("publisherSubmitBtn").textContent="Publier la mise à jour";
    showPublisherScreens(null);
  }
  form.scrollIntoView({behavior:"smooth",block:"start"});
}

function closePublisherForm(){
  if(isPublisherSubmitting)return;
  $("publisherForm").classList.add("hidden");
  $("publisherForm").closest(".publisher-layout")?.classList.add("publisher-form-closed");
  $("publisherForm").reset();
  resetPublisherMessage();
}

function setPublisherProgress(percent,textValue){
  $("publisherProgressWrap").classList.remove("hidden");
  $("publisherProgressBar").style.width=`${Math.max(0,Math.min(100,percent))}%`;
  $("publisherProgressText").textContent=textValue;
}

async function uploadPublisherFile(bucket,path,file,onProgress=()=>{}){
  const contentType=file.type||(bucket==="app-apk"?"application/vnd.android.package-archive":"application/octet-stream");
  if(file.size<=6*1024*1024||!window.tus){
    onProgress(15);
    const {error}=await sb.storage.from(bucket).upload(path,file,{upsert:false,contentType,cacheControl:"3600"});
    if(error)throw error;
    onProgress(100);
    return path;
  }

  const {data:{session},error:sessionError}=await sb.auth.getSession();
  if(sessionError||!session)throw sessionError||new Error("Reconnecte-toi avant l’envoi du fichier.");
  const projectUrl=new URL(SUPABASE_URL);
  const storageHost=projectUrl.hostname.endsWith(".supabase.co")?projectUrl.hostname.replace(".supabase.co",".storage.supabase.co"):projectUrl.hostname;
  const endpoint=`${projectUrl.protocol}//${storageHost}/storage/v1/upload/resumable`;

  await new Promise((resolve,reject)=>{
    const upload=new tus.Upload(file,{
      endpoint,
      retryDelays:[0,3000,5000,10000,20000],
      headers:{authorization:`Bearer ${session.access_token}`,apikey:SUPABASE_KEY,"x-upsert":"false"},
      uploadDataDuringCreation:true,
      removeFingerprintOnSuccess:true,
      chunkSize:6*1024*1024,
      metadata:{bucketName:bucket,objectName:path,contentType,cacheControl:"3600"},
      onError:reject,
      onProgress:(sent,total)=>onProgress(total?Math.round(sent/total*100):0),
      onSuccess:resolve
    });
    upload.findPreviousUploads().then(previous=>{
      if(previous.length)upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(()=>upload.start());
  });
  return path;
}

function validatePublisherFiles(icon,screens){
  const imageTypes=["image/png","image/jpeg","image/webp"];
  if(icon&&(!imageTypes.includes(icon.type)||icon.size>5*1024*1024))throw new Error("Le logo doit être une image PNG, JPG ou WebP de 5 Mo maximum.");
  for(const screen of screens){
    if(!imageTypes.includes(screen.type)||screen.size>10*1024*1024)throw new Error("Chaque capture doit être une image PNG, JPG ou WebP de 10 Mo maximum.");
  }
}

async function uploadPublisherMedia(appId,icon,screens,progressStart=75){
  let iconPath=null;
  const screenPaths=[];
  const total=(icon?1:0)+screens.length;
  let done=0;
  if(icon){
    iconPath=`${appId}/icon/${Date.now()}-${safeFileName(icon.name)}`;
    await uploadPublisherFile("app-icons",iconPath,icon,p=>setPublisherProgress(progressStart+((done+p/100)/Math.max(total,1))*(98-progressStart),"Envoi du logo…"));
    done++;
  }
  for(let i=0;i<screens.length;i++){
    const file=screens[i];
    const path=`${appId}/screens/${Date.now()}-${i}-${safeFileName(file.name)}`;
    await uploadPublisherFile("app-screenshots",path,file,p=>setPublisherProgress(progressStart+((done+p/100)/Math.max(total,1))*(98-progressStart),`Envoi de la capture ${i+1}/${screens.length}…`));
    screenPaths.push(path);
    done++;
  }
  return {iconPath,screenPaths};
}

async function insertPublisherScreens(appId,paths,startOrder=0){
  if(!paths.length)return;
  const rows=paths.map((storage_path,index)=>({app_id:appId,storage_path,sort_order:startOrder+index,created_by:currentUser.id}));
  const {error}=await sb.from("app_screenshots").insert(rows);
  if(error)throw error;
}

function nextPublisherScreenOrder(app){
  const orders=(app?.app_screenshots||[]).map(x=>Number(x.sort_order)||0);
  return orders.length?Math.max(...orders)+1:0;
}

async function refreshAfterPublisherChange(){
  await Promise.all([loadAdminPublisher(),loadApps()]);
  if(hasGendarmerieAccess())await loadPrivateApps();
  await loadAdminDashboard();
}

$("publisherForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!isAdmin||isPublisherSubmitting)return;
  const form=e.currentTarget;
  const mode=$("publisherMode").value;
  const appId=mode==="create"?makeId():$("publisherAppId").value;
  const current=mode==="create"?null:publisherRowById(appId);
  const msg=$("publisherMessage");
  const icon=$("publisherIcon").files?.[0]||null;
  const screens=[...($("publisherScreenshots").files||[])];
  const apk=$("publisherApk").files?.[0]||null;
  const version=$("publisherVersion").value.trim();
  const changes=linesToArray($("publisherChanges").value);
  try{validatePublisherFiles(icon,screens)}catch(err){msg.className="form-message error";msg.textContent=err.message;return}

  if((mode==="create"||mode==="update")&&!apk){msg.className="form-message error";msg.textContent="Choisis le fichier APK.";return}
  if((mode==="create"||mode==="update")&&!version){msg.className="form-message error";msg.textContent="Indique le numéro de version.";return}
  if(apk&&!/\.apk$/i.test(apk.name)){msg.className="form-message error";msg.textContent="Le fichier choisi doit être un APK.";return}

  isPublisherSubmitting=true;
  $("publisherSubmitBtn").disabled=true;
  $("cancelPublisherBtn").disabled=true;
  msg.className="form-message";
  msg.textContent="Enregistrement en cours…";
  setPublisherProgress(2,"Préparation de la publication…");

  try{
    if(mode==="create"){
      const name=$("publisherName").value.trim();
      const slug=slugify($("publisherSlug").value.trim());
      if(!name||!slug)throw new Error("Le nom et l’identifiant sont obligatoires.");
      const {data:duplicate,error:duplicateError}=await sb.from("applications").select("id").eq("slug",slug).maybeSingle();
      if(duplicateError)throw duplicateError;
      if(duplicate)throw new Error("Cet identifiant est déjà utilisé par une autre application.");

      const stamp=Date.now();
      const apkPath=`${appId}/versions/${slugify(version)||"version"}-${stamp}/${safeFileName(apk.name)}`;
      await uploadPublisherFile("app-apk",apkPath,apk,p=>setPublisherProgress(5+p*.65,`Envoi de l’APK… ${p}%`));
      const media=await uploadPublisherMedia(appId,icon,screens,72);
      const status=$("publisherStatus").value;
      const now=new Date().toISOString();
      const row={
        id:appId,slug,name,version,category:$("publisherCategory").value.trim()||"Autres",
        description:$("publisherDescription").value.trim(),changes,visibility:$("publisherVisibility").value,
        status,icon_path:media.iconPath,apk_path:apkPath,created_by:currentUser.id,
        published_at:status==="published"?now:null
      };
      const {error:appError}=await sb.from("applications").insert(row);
      if(appError)throw appError;
      const {error:versionError}=await sb.from("app_versions").insert({app_id:appId,version,apk_path:apkPath,changes,published_at:now,created_by:currentUser.id});
      if(versionError)throw versionError;
      await insertPublisherScreens(appId,media.screenPaths,0);
    }else if(mode==="edit"){
      if(!current)throw new Error("Application introuvable. Actualise le tableau de bord.");
      const media=await uploadPublisherMedia(appId,icon,screens,20);
      const status=$("publisherStatus").value;
      const updates={
        name:$("publisherName").value.trim(),category:$("publisherCategory").value.trim()||"Autres",
        description:$("publisherDescription").value.trim(),visibility:$("publisherVisibility").value,status
      };
      if(media.iconPath)updates.icon_path=media.iconPath;
      if(status==="published"&&!current.published_at)updates.published_at=new Date().toISOString();
      const {error}=await sb.from("applications").update(updates).eq("id",appId);
      if(error)throw error;
      await insertPublisherScreens(appId,media.screenPaths,nextPublisherScreenOrder(current));
    }else{
      if(!current)throw new Error("Application introuvable. Actualise le tableau de bord.");
      if((current.app_versions||[]).some(v=>v.version===version))throw new Error("Cette version existe déjà pour cette application.");
      const stamp=Date.now();
      const apkPath=`${appId}/versions/${slugify(version)||"version"}-${stamp}/${safeFileName(apk.name)}`;
      await uploadPublisherFile("app-apk",apkPath,apk,p=>setPublisherProgress(5+p*.65,`Envoi de l’APK… ${p}%`));
      const media=await uploadPublisherMedia(appId,icon,screens,72);
      const now=new Date().toISOString();
      const {error:versionError}=await sb.from("app_versions").insert({app_id:appId,version,apk_path:apkPath,changes,published_at:now,created_by:currentUser.id});
      if(versionError)throw versionError;
      const updates={version,apk_path:apkPath,changes};
      if(media.iconPath)updates.icon_path=media.iconPath;
      const {error:appError}=await sb.from("applications").update(updates).eq("id",appId);
      if(appError)throw appError;
      await insertPublisherScreens(appId,media.screenPaths,nextPublisherScreenOrder(current));
    }

    const successText=mode==="update"?"La mise à jour est publiée.":mode==="edit"?"La configuration est enregistrée.":"L’application est publiée.";
    await refreshAfterPublisherChange();
    const refreshed=publisherRowById(appId);
    if(refreshed)openPublisherForm(mode==="create"?"edit":mode,refreshed);
    setPublisherProgress(100,"Publication terminée.");
    msg.className="form-message success";
    msg.textContent=successText;
  }catch(err){
    console.error("Publication:",err);
    msg.className="form-message error";
    msg.textContent=err?.message||"La publication a échoué.";
    setPublisherProgress(0,"Publication interrompue.");
  }finally{
    isPublisherSubmitting=false;
    $("publisherSubmitBtn").disabled=false;
    $("cancelPublisherBtn").disabled=false;
  }
});

$("newPublisherAppBtn").addEventListener("click",()=>openPublisherForm("create"));
$("refreshPublisherBtn").addEventListener("click",loadAdminPublisher);
$("closePublisherFormBtn").addEventListener("click",closePublisherForm);
$("cancelPublisherBtn").addEventListener("click",closePublisherForm);
$("publisherName").addEventListener("input",e=>{
  if($("publisherMode").value==="create"&&$("publisherSlug").dataset.auto==="true")$("publisherSlug").value=slugify(e.target.value);
});
$("publisherSlug").addEventListener("input",()=>{$("publisherSlug").dataset.auto="false"});

$("publisherAppList").addEventListener("click",async e=>{
  const edit=e.target.closest("[data-publisher-edit]");
  const update=e.target.closest("[data-publisher-update]");
  const toggle=e.target.closest("[data-publisher-toggle]");
  if(edit){const app=publisherRowById(edit.dataset.publisherEdit);if(app)openPublisherForm("edit",app);return}
  if(update){const app=publisherRowById(update.dataset.publisherUpdate);if(app)openPublisherForm("update",app);return}
  if(toggle){
    toggle.disabled=true;
    const status=toggle.dataset.nextStatus;
    const updates={status};
    const current=publisherRowById(toggle.dataset.publisherToggle);
    if(status==="published"&&!current?.published_at)updates.published_at=new Date().toISOString();
    const {error}=await sb.from("applications").update(updates).eq("id",toggle.dataset.publisherToggle);
    if(error)alert(error.message);else await refreshAfterPublisherChange();
    toggle.disabled=false;
  }
});

$("legacyAppsList").addEventListener("click",e=>{
  const btn=e.target.closest("[data-import-legacy]");
  if(!btn)return;
  const app=apps.find(x=>x.source==="github"&&x.id===btn.dataset.importLegacy);
  if(!app||!publisherAvailable)return;
  openPublisherForm("create");
  $("publisherName").value=app.name;
  $("publisherSlug").value=app.id;
  $("publisherSlug").dataset.auto="false";
  $("publisherCategory").value=app.category;
  $("publisherDescription").value=app.description;
  $("publisherVersion").value=app.version;
  $("publisherChanges").value=(app.changes||[]).join("\n");
  $("publisherMessage").textContent="Les informations ont été reprises. Choisis maintenant l’APK, le logo et les captures.";
});

$("publisherExistingScreens").addEventListener("click",async e=>{
  const btn=e.target.closest("[data-delete-publisher-screen]");
  if(!btn||!confirm("Supprimer définitivement cette capture d’écran ?"))return;
  btn.disabled=true;
  const id=btn.dataset.deletePublisherScreen,path=btn.dataset.screenPath;
  const {error}=await sb.from("app_screenshots").delete().eq("id",id);
  if(error){alert(error.message);btn.disabled=false;return}
  await sb.storage.from("app-screenshots").remove([path]);
  const appId=$("publisherAppId").value;
  await loadAdminPublisher();
  const app=publisherRowById(appId);
  if(app){$("publisherAppId").value=appId;await showPublisherScreens(app)}
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
  if(a.dataset.secureDownload)return;
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
