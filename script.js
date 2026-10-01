const OWNER="Romuel10";
const REPO="romuel-apps-releases-";
const API=`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`;

const SUPABASE_URL=window.MADA_SUPABASE_URL||"https://gmlofgsgnbbcbefogpww.supabase.co";
const SUPABASE_KEY=window.MADA_SUPABASE_KEY||"sb_publishable_5TlVWknK1BODxwWqw4efEA_y4DI-JRP";
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const STORE_NAME="Mada Apps";

const $=id=>document.getElementById(id);
const elApps=$("apps"),elStatus=$("status"),elQ=$("q"),elReload=$("reload");
const modal=$("modal"),authModal=$("authModal");
let apps=[],currentApp=null,currentUser=null,currentRating=0,authMode="signin",reviewStats={};
let currentStoreTab="home";
let privateApps=[];
let publisherApps=[],publisherScreens=[],publisherAvailable=true,isPublisherSubmitting=false;
const FAVORITES_KEY="madaapps_favorites";
let favorites=new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY)||localStorage.getItem("romuelapps_favorites")||"[]"));
let profile=null,isAdmin=false,isDeveloper=false,isGendarmerie=false,reportedReviewId=null,lastUnconfirmedEmail="";
let selectedAvatarFile=null,removeAvatarRequested=false;
let notifications=[],notificationChannel=null;
let serviceWorkerRegistration=null,pushSubscription=null,pushLinkedToCurrentUser=false,deferredInstallPrompt=null,pushVapidPublicKey="";
let pendingAppSlug=new URLSearchParams(location.search).get("app");
const storageSizeCache=new Map();

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
const formatBytes=bytes=>{
  const value=Number(bytes||0);
  if(!Number.isFinite(value)||value<=0)return "—";
  const units=["o","Ko","Mo","Go"];
  let size=value,index=0;
  while(size>=1024&&index<units.length-1){size/=1024;index++}
  const digits=index===0||size>=100?0:1;
  return `${size.toLocaleString("fr-FR",{minimumFractionDigits:0,maximumFractionDigits:digits})} ${units[index]}`;
};
const compactCount=value=>new Intl.NumberFormat("fr-FR",{notation:"compact",maximumFractionDigits:1}).format(Number(value||0));

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
      sizeBytes:Number(apk.size||0),
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
      sizeBytes:v.sizeBytes,
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

async function assetUrlMap(bucket,items,expires=3600){
  const rows=(items||[]).filter(item=>item?.path);
  const map=new Map();
  const supabasePaths=rows
    .filter(item=>(item.provider||"supabase")==="supabase")
    .map(item=>item.path);
  const r2Paths=rows
    .filter(item=>item.provider==="r2")
    .map(item=>item.path);

  const [supabaseMap,r2Map]=await Promise.all([
    signedUrlMap(bucket,supabasePaths,expires),
    window.MadaR2?.signedUrls
      ? window.MadaR2.signedUrls(bucket,r2Paths,expires).catch(error=>{
          console.warn("URLs R2:",error);
          return new Map();
        })
      : Promise.resolve(new Map())
  ]);

  for(const [path,url] of supabaseMap)map.set(path,url);
  for(const [path,url] of r2Map)map.set(path,url);
  return map;
}

async function storageFileSize(bucket,path,provider="supabase"){
  if(!bucket||!path)return 0;
  const cacheKey=`${provider}:${bucket}:${path}`;
  if(storageSizeCache.has(cacheKey))return storageSizeCache.get(cacheKey);

  const request=(async()=>{
    if(provider==="r2"&&window.MadaR2?.size){
      return Number(await window.MadaR2.size(bucket,path)||0);
    }

    const cut=path.lastIndexOf("/");
    const folder=cut>=0?path.slice(0,cut):"";
    const fileName=cut>=0?path.slice(cut+1):path;
    const {data,error}=await sb.storage.from(bucket).list(folder,{limit:20,search:fileName});
    if(error){
      console.warn(`Taille ${path}:`,error.message);
      return 0;
    }
    const file=(data||[]).find(item=>item.name===fileName);
    return Number(file?.metadata?.size||file?.metadata?.contentLength||file?.metadata?.["content-length"]||0);
  })().catch(error=>{
    console.warn(`Taille ${path}:`,error);
    return 0;
  });

  storageSizeCache.set(cacheKey,request);
  return request;
}

async function hydratePublisherFileSizes(rows,bucket="app-apk"){
  await Promise.all((rows||[]).map(async row=>{
    const versions=row.app_versions||[];
    const sizes=await Promise.all([
      storageFileSize(bucket,row.apk_path,row.apk_storage_provider||"supabase"),
      ...versions.map(version=>storageFileSize(
        bucket,
        version.apk_path,
        version.storage_provider||"supabase"
      ))
    ]);
    row.apk_size_bytes=sizes[0]||0;
    versions.forEach((version,index)=>{version.apk_size_bytes=sizes[index+1]||0});
  }));
  return rows;
}

async function restoreScreenshotRowsFromStorage(rows){
  await Promise.all((rows||[]).map(async row=>{
    if((row.app_screenshots||[]).some(screen=>screen.storage_path))return;
    const folder=`${row.id}/screens`;
    const {data,error}=await sb.storage.from("app-screenshots").list(folder,{
      limit:100,
      sortBy:{column:"name",order:"asc"}
    });
    if(error){
      console.warn(`Captures ${row.slug}:`,error.message);
      return;
    }
    row.app_screenshots=(data||[])
      .filter(file=>file?.name&&/\.(png|jpe?g|webp)$/i.test(file.name))
      .map((file,index)=>({
        id:null,
        storage_path:`${folder}/${file.name}`,
        storage_provider:"supabase",
        alt_text:`Capture de ${row.name}`,
        sort_order:index
      }));
  }));
  return rows;
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
      apkProvider:v.storage_provider||"supabase",
      sizeBytes:Number(v.apk_size_bytes||0),
      source:"supabase",
      published:v.published_at,
      changes:Array.isArray(v.changes)?v.changes:[]
    }));

  if(!versions.some(v=>v.version===row.version)){
    versions.unshift({
      version:row.version,
      apkPath:row.apk_path,
      apkBucket:"app-apk",
      apkProvider:row.apk_storage_provider||"supabase",
      sizeBytes:Number(row.apk_size_bytes||0),
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
    apkProvider:row.apk_storage_provider||"supabase",
    sizeBytes:Number(row.apk_size_bytes||0),
    downloads:Number(row.download_count||0),
    icon:iconUrls.get(row.icon_path)||"",
    iconPath:row.icon_path||null,
    iconProvider:row.icon_storage_provider||"supabase",
    screenshots,
    published:row.updated_at||row.published_at||row.created_at,
    versions
  };
}

async function fetchPublisherCatalog(visibility){
  const {data,error}=await sb.from("applications")
    .select("id,slug,name,version,category,description,changes,visibility,status,icon_path,icon_storage_provider,apk_path,apk_storage_provider,download_count,published_at,updated_at,created_at,app_versions(id,version,apk_path,storage_provider,changes,published_at),app_screenshots(id,storage_path,storage_provider,alt_text,sort_order)")
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
  await Promise.all([
    restoreScreenshotRowsFromStorage(rows),
    hydratePublisherFileSizes(rows)
  ]);

  const assetLifetime=visibility==="gendarmerie"?300:3600;
  const iconUrls=await assetUrlMap(
    "app-icons",
    rows.map(x=>({
      path:x.icon_path,
      provider:x.icon_storage_provider||"supabase"
    })),
    assetLifetime
  );
  const screenUrls=await assetUrlMap(
    "app-screenshots",
    rows.flatMap(x=>(x.app_screenshots||[]).map(s=>({
      path:s.storage_path,
      provider:s.storage_provider||"supabase"
    }))),
    assetLifetime
  );

  return rows.map(row=>normalizePublisherApp(row,iconUrls,screenUrls));
}

function iconHtml(a){const n=esc(a.name),ini=esc(initials(a.name));return a.icon?`<img class="icon" src="${esc(a.icon)}" alt="Logo ${n}"><div class="fallback hidden">${ini}</div>`:`<div class="fallback">${ini}</div>`}
document.addEventListener("error",event=>{
  const image=event.target;
  if(!(image instanceof HTMLImageElement)||!image.classList.contains("icon"))return;
  image.classList.add("hidden");
  image.nextElementSibling?.classList.remove("hidden");
},true);

function downloadHtml(a,label="Installer"){
  if(a.apkPath){
    return `<button class="download" type="button" data-secure-download="${esc(a.id)}" data-apk-path="${esc(a.apkPath)}" data-apk-bucket="${esc(a.apkBucket||"app-apk")}" data-storage-provider="${esc(a.apkProvider||"supabase")}">${esc(label)}</button>`;
  }
  return `<a class="download" href="${esc(a.apk)}">${esc(label)}</a>`;
}
function starsFrom(avg){const n=Math.round(Number(avg)||0);return "★★★★★".split("").map((s,i)=>i<n?"★":"☆").join("")}
function appFactsHtml(a,stats){
  const rating=stats?.count?stats.avg.toFixed(1):"—";
  return `<div class="app-card-facts">
    <span><strong>${esc(rating)}</strong> ★</span>
    <span><strong>${esc(formatBytes(a.sizeBytes))}</strong> Taille</span>
    <span><strong>${esc(compactCount(a.downloads))}</strong> téléchargements</span>
  </div>`;
}
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
    return `<article class="card app-card">
      <div class="head">${iconHtml(a)}<div class="app-card-title"><h3>${esc(a.name)}</h3><p class="app-publisher-name">Mada Apps</p><p class="meta">Version ${esc(a.version)} • ${esc(fmtDate(a.published))}</p><div class="detail-badges"><span class="category-badge">${esc(a.category)}</span>${isNewApp(a)?'<span class="new-badge">Nouveau</span>':""}${favorites.has(a.id)?'<span class="favorite-badge">♥ Favori</span>':""}</div></div></div>
      ${appFactsHtml(a,st)}
      <p class="desc">${esc(a.description)}</p>
      <div class="actions">${downloadHtml(a)}<button class="details" type="button" data-details="${i}">Détails</button></div>
    </article>`;
  }).join("");
}

function featureCard(a){
  const st=reviewStats[a.id]||{avg:0,count:0};
  return `<article class="feature-card">
    <div class="head">${iconHtml(a)}<div class="app-card-title"><h4>${esc(a.name)}</h4><p class="app-publisher-name">Mada Apps</p><p class="meta">Version ${esc(a.version)}</p></div></div>
    ${appFactsHtml(a,st)}
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

function refreshMobileNav(){
  const mobileNav=$("mobileNav");
  if(!mobileNav)return;
  const map={
    home:$("mobileHomeBtn"),
    all:$("mobileAppsBtn"),
    favorites:$("mobileFavoritesBtn")
  };
  Object.values(map).forEach(btn=>{
    btn?.classList.remove("active");
    btn?.removeAttribute("aria-current");
  });
  const active=map[currentStoreTab];
  if(active){
    active.classList.add("active");
    active.setAttribute("aria-current","page");
  }
  $("mobileAccountLabel").textContent=currentUser?"Compte":"Connexion";
}

function refreshStoreView(){
  refreshMobileNav();
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
  const {data,error}=await sb.from("profiles").select("id,display_name,avatar_url,is_admin,access_level,role").eq("id",currentUser.id).maybeSingle();
  if(error){console.warn(error);return}
  profile=data||null;
  isAdmin=!!profile?.is_admin;
  isDeveloper=profile?.role==="DEVELOPER" || profile?.access_level==="developer";
  isGendarmerie=profile?.role==="GENDARMERIE" || profile?.access_level==="gendarme";
  refreshProfileUI();
  refreshPrivateAccessUI();
}


function hasGendarmerieAccess(){
  return !!currentUser && (isAdmin || profile?.role==="GENDARMERIE" || profile?.access_level==="gendarme");
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
function closeUserMenu(){
  const menu=$("userMenu");
  if(!menu)return;
  menu.classList.add("hidden");
  $("profileBtn")?.setAttribute("aria-expanded","false");
}

function openUserMenu(){
  if(!currentUser)return;
  $("userMenu")?.classList.remove("hidden");
  $("profileBtn")?.setAttribute("aria-expanded","true");
}

function toggleUserMenu(){
  if(!currentUser)return;
  const menu=$("userMenu");
  if(!menu)return;
  if(menu.classList.contains("hidden"))openUserMenu();
  else closeUserMenu();
}

function accountRoleLabel(){
  if(isAdmin)return "Administrateur";
  if(isDeveloper)return "Développeur";
  if(isGendarmerie)return "Gendarmerie";
  return "Utilisateur";
}

function accountInitials(){
  return initials(profile?.display_name||currentUser?.email?.split("@")[0]||"M")||"M";
}


function notificationDate(value){
  try{
    return new Intl.DateTimeFormat("fr-FR",{
      day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"
    }).format(new Date(value));
  }catch{return ""}
}

function unreadNotificationCount(){
  return notifications.filter(item=>!item.read).length;
}

function isStandalonePwa(){
  return window.matchMedia?.("(display-mode: standalone)")?.matches===true || window.navigator.standalone===true;
}

function isIosDevice(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent||"");
}

function pushIsSupported(){
  return window.isSecureContext
    && "serviceWorker" in navigator
    && "PushManager" in window
    && typeof Notification!=="undefined";
}

async function getPushVapidPublicKey(){
  if(pushVapidPublicKey)return pushVapidPublicKey;
  const {data,error}=await sb.from("web_push_config_public")
    .select("public_key")
    .eq("id",1)
    .maybeSingle();
  if(error)throw error;
  pushVapidPublicKey=data?.public_key||"";
  if(!pushVapidPublicKey)throw new Error("Configuration Push indisponible.");
  return pushVapidPublicKey;
}

function urlBase64ToUint8Array(value){
  const padding="=".repeat((4-value.length%4)%4);
  const base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(base64);
  return Uint8Array.from([...raw].map(char=>char.charCodeAt(0)));
}

function isAllowedPushEndpoint(endpoint){
  try{
    const url=new URL(endpoint);
    if(url.protocol!=="https:")return false;
    const host=url.hostname.toLowerCase();
    return host==="fcm.googleapis.com"
      || host==="updates.push.services.mozilla.com"
      || host.endsWith(".push.services.mozilla.com")
      || host.endsWith(".push.apple.com");
  }catch{return false}
}

async function registerMadaServiceWorker(){
  if(!("serviceWorker" in navigator))return null;
  if(serviceWorkerRegistration)return serviceWorkerRegistration;
  const registration=await navigator.serviceWorker.register("./sw.js",{scope:"./"});
  serviceWorkerRegistration=await navigator.serviceWorker.ready;
  return serviceWorkerRegistration||registration;
}

function refreshPwaInstallUI(){
  const card=$("pwaInstallCard");
  const button=$("installPwaBtn");
  const text=$("pwaInstallText");
  if(!card||!button||!text)return;

  if(isStandalonePwa()){
    card.classList.add("hidden");
    return;
  }

  if(deferredInstallPrompt){
    card.classList.remove("hidden");
    text.textContent="Installe Mada Apps sur ton écran d’accueil pour l’ouvrir comme une application.";
    button.textContent="Installer";
    button.classList.remove("hidden");
    button.disabled=false;
    return;
  }

  if(isIosDevice()){
    card.classList.remove("hidden");
    text.textContent="Sur iPhone/iPad : ouvre le menu Partager puis choisis « Sur l’écran d’accueil ». Les notifications push pourront ensuite être activées.";
    button.textContent="Comment faire";
    button.classList.remove("hidden");
    button.disabled=false;
    return;
  }

  card.classList.add("hidden");
}

async function installMadaPwa(){
  if(deferredInstallPrompt){
    const prompt=deferredInstallPrompt;
    deferredInstallPrompt=null;
    await prompt.prompt();
    try{await prompt.userChoice}catch{}
    refreshPwaInstallUI();
    return;
  }
  if(isIosDevice()){
    alert("Sur iPhone/iPad : touche Partager, puis « Sur l’écran d’accueil ». Ouvre ensuite Mada Apps depuis son icône et active les notifications.");
  }
}

function refreshBrowserNotificationUI(){
  const card=$("browserNotificationCard");
  const button=$("pushNotificationsBtn");
  const text=$("browserNotificationText");
  if(!card||!button||!text)return;

  refreshPwaInstallUI();

  if(!pushIsSupported()){
    card.classList.remove("hidden");
    text.textContent="Les notifications push ne sont pas prises en charge par ce navigateur ou ce contexte.";
    button.textContent="Indisponible";
    button.disabled=true;
    return;
  }

  if(isIosDevice()&&!isStandalonePwa()){
    card.classList.remove("hidden");
    text.textContent="Sur iPhone/iPad, ajoute d’abord Mada Apps à l’écran d’accueil puis ouvre-le depuis son icône.";
    button.textContent="Installer d’abord";
    button.disabled=true;
    return;
  }

  card.classList.remove("hidden");

  if(Notification.permission==="denied"){
    text.textContent="Les notifications sont bloquées. Réactive-les dans les paramètres du navigateur ou du téléphone.";
    button.textContent="Bloquées";
    button.disabled=true;
    return;
  }

  if(pushLinkedToCurrentUser){
    text.textContent="Activées : les mises à jour peuvent arriver sur cet appareil même lorsque Mada Apps est fermé.";
    button.textContent="Désactiver";
    button.disabled=false;
    button.classList.add("push-enabled");
    return;
  }

  button.classList.remove("push-enabled");
  text.textContent="Active les notifications push pour recevoir les mises à jour même lorsque Mada Apps est fermé.";
  button.textContent="Activer";
  button.disabled=!currentUser;
}

async function loadPushDeviceState(){
  pushSubscription=null;
  pushLinkedToCurrentUser=false;

  if(!currentUser||!pushIsSupported()){
    refreshBrowserNotificationUI();
    return;
  }

  try{
    const registration=await registerMadaServiceWorker();
    if(!registration){
      refreshBrowserNotificationUI();
      return;
    }

    pushSubscription=await registration.pushManager.getSubscription();
    if(!pushSubscription){
      refreshBrowserNotificationUI();
      return;
    }

    const {data,error}=await sb.from("push_subscriptions")
      .select("id")
      .eq("user_id",currentUser.id)
      .eq("endpoint",pushSubscription.endpoint)
      .maybeSingle();

    if(error)console.warn("État Push:",error.message);
    pushLinkedToCurrentUser=!!data;
  }catch(error){
    console.warn("État Push:",error);
  }

  refreshBrowserNotificationUI();
}

async function enablePushNotifications(){
  if(!currentUser){
    setAuthMode("signin");
    openAuth();
    return;
  }

  if(!pushIsSupported()){
    refreshBrowserNotificationUI();
    return;
  }

  if(isIosDevice()&&!isStandalonePwa()){
    refreshPwaInstallUI();
    return;
  }

  const button=$("pushNotificationsBtn");
  if(button)button.disabled=true;

  try{
    const permission=Notification.permission==="granted"
      ?"granted"
      :await Notification.requestPermission();

    if(permission!=="granted"){
      await loadPushDeviceState();
      return;
    }

    const registration=await registerMadaServiceWorker();
    if(!registration)throw new Error("Service Worker indisponible.");

    let subscription=await registration.pushManager.getSubscription();
    if(!subscription){
      subscription=await registration.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:urlBase64ToUint8Array(await getPushVapidPublicKey())
      });
    }

    if(!isAllowedPushEndpoint(subscription.endpoint)){
      await subscription.unsubscribe();
      throw new Error("Service de notifications non reconnu sur cet appareil.");
    }

    const serialized=subscription.toJSON();
    const p256dh=serialized.keys?.p256dh;
    const auth=serialized.keys?.auth;
    if(!p256dh||!auth)throw new Error("Clés d’abonnement Push incomplètes.");

    const {error}=await sb.from("push_subscriptions").upsert({
      user_id:currentUser.id,
      endpoint:subscription.endpoint,
      p256dh,
      auth_key:auth,
      user_agent:navigator.userAgent.slice(0,500),
      enabled:true,
      updated_at:new Date().toISOString()
    },{onConflict:"user_id,endpoint"});

    if(error)throw error;

    pushSubscription=subscription;
    pushLinkedToCurrentUser=true;
  }catch(error){
    console.warn("Activation Push:",error);
    alert(error?.message||"Impossible d’activer les notifications push sur cet appareil.");
  }

  refreshBrowserNotificationUI();
}

async function disablePushNotifications({silent=false}={}){
  if(!pushIsSupported()){
    pushSubscription=null;
    pushLinkedToCurrentUser=false;
    refreshBrowserNotificationUI();
    return;
  }

  try{
    const registration=await registerMadaServiceWorker();
    const subscription=pushSubscription||await registration?.pushManager.getSubscription();

    if(subscription&&currentUser){
      const {error}=await sb.from("push_subscriptions")
        .delete()
        .eq("user_id",currentUser.id)
        .eq("endpoint",subscription.endpoint);
      if(error&&!silent)console.warn("Suppression abonnement Push:",error.message);
    }

    if(subscription)await subscription.unsubscribe();
  }catch(error){
    if(!silent)console.warn("Désactivation Push:",error);
  }

  pushSubscription=null;
  pushLinkedToCurrentUser=false;
  refreshBrowserNotificationUI();
}

async function togglePushNotifications(){
  if(pushLinkedToCurrentUser)await disablePushNotifications();
  else await enablePushNotifications();
}

function refreshNotificationBadges(){
  const unread=unreadNotificationCount();
  const badge=$("notificationBadge");
  if(badge){
    badge.textContent=unread>99?"99+":String(unread);
    badge.classList.toggle("hidden",!currentUser||unread===0);
  }
  $("notificationsBtn")?.classList.toggle("has-unread",unread>0);
  if($("notificationsUnreadLabel")){
    $("notificationsUnreadLabel").textContent=String(unread)+" non lue"+(unread>1?"s":"");
  }
  if($("notificationsSummary")){
    $("notificationsSummary").textContent=unread
      ? String(unread)+" mise"+(unread>1?"s":"")+" à jour à consulter."
      : "Aucune nouvelle notification.";
  }
  if($("menuNotificationsHint")){
    $("menuNotificationsHint").textContent=unread
      ? String(unread)+" notification"+(unread>1?"s":"")+" non lue"+(unread>1?"s":"")
      : "Voir les mises à jour";
  }
  if($("markAllNotificationsBtn"))$("markAllNotificationsBtn").disabled=unread===0;
}

function renderNotifications(){
  const box=$("notificationsList");
  if(!box)return;

  if(!currentUser){
    box.innerHTML='<div class="notification-empty">Connecte-toi pour voir tes notifications.</div>';
    refreshNotificationBadges();
    return;
  }

  if(!notifications.length){
    box.innerHTML='<div class="notification-empty"><strong>Tout est à jour.</strong><span>Les prochaines mises à jour de tes applications apparaîtront ici.</span></div>';
    refreshNotificationBadges();
    return;
  }

  box.innerHTML=notifications.map(item=>{
    const unreadDot=item.read?"":'<span class="notification-unread-dot" aria-label="Non lue"></span>';
    const meta=(item.version?"Version "+esc(item.version)+" • ":"")+esc(notificationDate(item.created_at));
    return '<button class="notification-item '+(item.read?"":"unread")+'" type="button" data-notification-id="'+esc(item.id)+'">'
      +'<span class="notification-item-icon" aria-hidden="true">'+(item.type==="app_update"?"↻":"🔔")+'</span>'
      +'<span class="notification-item-body">'
      +'<span class="notification-item-top"><strong>'+esc(item.title||"Notification")+'</strong>'+unreadDot+'</span>'
      +'<span class="notification-item-message">'+esc(item.message||"")+'</span>'
      +'<span class="notification-item-meta">'+meta+'</span>'
      +'</span></button>';
  }).join("");
  refreshNotificationBadges();
}

async function loadNotifications(){
  if(!currentUser){
    notifications=[];
    renderNotifications();
    return;
  }

  const {data,error}=await sb.from("notifications")
    .select("id,title,message,read,created_at,type,app_id,app_slug,version,event_key,changes,read_at")
    .eq("user_id",currentUser.id)
    .order("created_at",{ascending:false})
    .limit(60);

  if(error){
    console.warn("Notifications:",error.message);
    notifications=[];
    renderNotifications();
    return;
  }

  notifications=data||[];
  renderNotifications();
}

function closeNotifications(){
  $("notificationsPanel")?.classList.add("hidden");
  $("notificationsBackdrop")?.classList.add("hidden");
  $("notificationsBtn")?.setAttribute("aria-expanded","false");
}

async function openNotifications(){
  if(!currentUser){
    setAuthMode("signin");
    openAuth();
    return;
  }
  closeUserMenu();
  $("notificationsPanel")?.classList.remove("hidden");
  $("notificationsBackdrop")?.classList.remove("hidden");
  $("notificationsBtn")?.setAttribute("aria-expanded","true");
  refreshBrowserNotificationUI();
  await loadNotifications();
}

async function markNotificationRead(id){
  if(!currentUser||!id)return;
  const row=notifications.find(item=>item.id===id);
  if(row?.read)return;

  const readAt=new Date().toISOString();
  const {error}=await sb.from("notifications")
    .update({read:true,read_at:readAt})
    .eq("id",id)
    .eq("user_id",currentUser.id);

  if(error){
    console.warn("Notification lue:",error.message);
    return;
  }

  if(row){
    row.read=true;
    row.read_at=readAt;
  }
  renderNotifications();
}

async function markAllNotificationsRead(){
  if(!currentUser||unreadNotificationCount()===0)return;
  const button=$("markAllNotificationsBtn");
  if(button)button.disabled=true;
  const readAt=new Date().toISOString();
  const {error}=await sb.from("notifications")
    .update({read:true,read_at:readAt})
    .eq("user_id",currentUser.id)
    .eq("read",false);

  if(error){
    console.warn("Notifications lues:",error.message);
    if(button)button.disabled=false;
    return;
  }

  notifications.forEach(item=>{
    if(!item.read){item.read=true;item.read_at=readAt}
  });
  renderNotifications();
}

async function openNotificationTarget(item){
  if(!item)return;
  await markNotificationRead(item.id);
  closeNotifications();

  if(!item.app_slug)return;
  const target=apps.find(app=>app.id===item.app_slug)||privateApps.find(app=>app.id===item.app_slug);
  if(target){
    openDetails(target);
    return;
  }

  const url=new URL(location.href);
  url.searchParams.set("app",item.app_slug);
  location.href=url.toString();
}

function showBrowserUpdateAlert(item){
  if(pushLinkedToCurrentUser)return;
  if(typeof Notification==="undefined"||Notification.permission!=="granted")return;
  try{
    const alert=new Notification(item.title||"Mada Apps",{
      body:item.message||"Une nouvelle mise à jour est disponible.",
      tag:item.event_key||item.id
    });
    alert.onclick=()=>{
      window.focus();
      openNotificationTarget(item);
      alert.close();
    };
  }catch(error){
    console.warn("Alerte navigateur:",error);
  }
}



function stopNotificationSubscription(){
  if(notificationChannel){
    try{sb.removeChannel(notificationChannel)}catch{}
    notificationChannel=null;
  }
}

function subscribeToNotifications(){
  stopNotificationSubscription();
  if(!currentUser)return;

  notificationChannel=sb
    .channel("madaapps-notifications-"+currentUser.id)
    .on(
      "postgres_changes",
      {
        event:"INSERT",
        schema:"public",
        table:"notifications",
        filter:"user_id=eq."+currentUser.id
      },
      payload=>{
        const item=payload.new;
        if(!item?.id)return;
        if(!notifications.some(existing=>existing.id===item.id)){
          notifications.unshift(item);
          notifications=notifications.slice(0,60);
        }
        renderNotifications();
        showBrowserUpdateAlert(item);
      }
    )
    .subscribe(status=>{
      if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"){
        console.warn("Notifications temps réel:",status);
      }
    });
}

function clearNotificationState(){
  stopNotificationSubscription();
  notifications=[];
  pushSubscription=null;
  pushLinkedToCurrentUser=false;
  closeNotifications();
  renderNotifications();
  refreshBrowserNotificationUI();
}

function refreshProfileUI(){
  const loggedIn=!!currentUser;
  $("profileLoggedOut").classList.toggle("hidden",loggedIn);
  $("profileForm").classList.toggle("hidden",!loggedIn);
  $("adminBtn").classList.toggle("hidden",!isAdmin);
  $("developerBtn").classList.toggle("hidden",!isDeveloper);
  $("gendarmerieBtn").classList.toggle("hidden",!isGendarmerie);

  $("profileBtnLabel").textContent=loggedIn?"Mon espace":"Se connecter";
  $("mobileAccountLabel").textContent=loggedIn?"Compte":"Connexion";
  $("notificationsBtn")?.classList.toggle("hidden",!loggedIn);
  refreshNotificationBadges();
  $("profileBtn").classList.toggle("account-entry-btn",!loggedIn);
  $("profileBtnChevron").classList.toggle("hidden",!loggedIn);
  $("heroLoginBtn").textContent=loggedIn?"Ouvrir mon espace":"Se connecter / Créer un compte";
  $("gettingStarted")?.classList.toggle("hidden",loggedIn || localStorage.getItem("madaapps_hide_beginner_guide")==="1");

  if(loggedIn){
    $("profileName").value=profile?.display_name||"";
    setAvatarPreview(profile?.avatar_url||"");
    selectedAvatarFile=null;
    removeAvatarRequested=false;

    const displayName=profile?.display_name||currentUser.email?.split("@")[0]||"Utilisateur";
    const roleLabel=accountRoleLabel();
    $("headerUserName").textContent=displayName;
    $("headerUserEmail").textContent=currentUser.email||"";
    $("headerRoleBadge").textContent=roleLabel;

    const triggerAvatar=$("profileBtnAvatar");
    triggerAvatar.classList.remove("hidden");
    if(profile?.avatar_url){
      triggerAvatar.innerHTML=`<img src="${esc(profile.avatar_url)}" alt="">`;
      $("userMenuAvatar").innerHTML=`<img src="${esc(profile.avatar_url)}" alt="">`;
    }else{
      const ini=esc(accountInitials());
      triggerAvatar.textContent=ini;
      $("userMenuAvatar").textContent=ini;
    }
  }else{
    $("profileBtnAvatar").classList.add("hidden");
    $("profileBtnAvatar").textContent="";
    $("userMenuAvatar").textContent="M";
    $("headerUserName").textContent="Utilisateur";
    $("headerUserEmail").textContent="";
    $("headerRoleBadge").textContent="Utilisateur";
    closeUserMenu();
  }
}

async function loadFavoritesFromSupabase(){
  if(!currentUser)return;
  const {data,error}=await sb.from("favorites").select("app_id").eq("user_id",currentUser.id);
  if(error){console.warn(error);return}
  favorites=new Set((data||[]).map(x=>x.app_id));
  localStorage.setItem(FAVORITES_KEY,JSON.stringify([...favorites]));
  filter();
}

async function syncFavorite(appId,shouldFavorite){
  if(!currentUser){
    localStorage.setItem(FAVORITES_KEY,JSON.stringify([...favorites]));
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
    return `<button class="version-download" type="button" data-secure-download="${esc(app.id)}" data-apk-path="${esc(version.apkPath)}" data-apk-bucket="${esc(version.apkBucket||app.apkBucket||"app-apk")}" data-storage-provider="${esc(version.apkProvider||app.apkProvider||"supabase")}">Installer</button>`;
  }
  return `<a href="${esc(version.apk||app.apk)}">Installer</a>`;
}

function openDetails(app,options={}){
  currentApp=app;
  if(!options.skipUrl)setAppUrl(app);
  document.title=`${app.name} — ${STORE_NAME}`;
  $("modalIconWrap").innerHTML=iconHtml(app);
  $("modalTitle").textContent=app.name;
  $("modalMeta").textContent=`Mise à jour le ${fmtDate(app.published)}`;
  $("modalSize").textContent=formatBytes(app.sizeBytes);
  $("modalVersion").textContent=app.version||"—";
  $("modalCategory").textContent=app.category||"Autres";
  $("modalNewBadge").classList.toggle("hidden",!isNewApp(app));
  $("modalDescription").textContent=app.description;
  const modalDownload=$("modalDownload");
  if(app.apkPath){
    modalDownload.href="#";
    modalDownload.dataset.secureDownload=app.id;
    modalDownload.dataset.apkPath=app.apkPath;
    modalDownload.dataset.apkBucket=app.apkBucket||"app-apk";
    modalDownload.dataset.storageProvider=app.apkProvider||"supabase";
  }else{
    modalDownload.href=app.apk;
    delete modalDownload.dataset.secureDownload;
    delete modalDownload.dataset.apkPath;
    delete modalDownload.dataset.apkBucket;
    delete modalDownload.dataset.storageProvider;
  }
  $("modalDownloads").textContent=Number(app.downloads||0).toLocaleString("fr-FR");
  $("favoriteBtn").textContent=favorites.has(app.id)?"♥ Favori":"♡ Favori";
  $("favoriteBtn").classList.toggle("favorite-active",favorites.has(app.id));
  if(app.changes?.length){$("modalChanges").innerHTML=app.changes.map(x=>`<p>• ${esc(x)}</p>`).join("");$("changesBlock").style.display=""}else{$("changesBlock").style.display="none"}
  $("versionsList").innerHTML=(app.versions||[]).map(v=>`
    <div class="version-row">
      <span class="version-pill">v${esc(v.version)}</span>
      <div><div>${esc(fmtDate(v.published))}</div><div class="version-date">${esc(formatBytes(v.sizeBytes))} • ${esc((v.changes||[])[0]||"Version publiée")}</div></div>
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
  document.title=STORE_NAME;
  if(!options.skipUrl)setAppUrl(null);
}

function openAuth(){
  authModal.classList.add("show");authModal.setAttribute("aria-hidden","false");document.body.classList.add("modal-open");
  $("authPassword").type="password";
  $("togglePasswordBtn").textContent="Afficher";
  $("togglePasswordBtn").setAttribute("aria-label","Afficher le mot de passe");
  $("togglePasswordBtn").setAttribute("aria-pressed","false");
  refreshAuthUI();
  setTimeout(()=>$("authEmail")?.focus(),60);
}
function closeAuth(){authModal.classList.remove("show");authModal.setAttribute("aria-hidden","true");document.body.classList.remove("modal-open")}

function setAuthMode(mode){
  authMode=mode;
  $("signInTab").classList.toggle("active",mode==="signin");
  $("signUpTab").classList.toggle("active",mode==="signup");
  $("authTitle").textContent=mode==="signin"?"Connexion":"Créer un compte";
  $("authSubmitBtn").textContent=mode==="signin"?"Se connecter":"Créer mon compte";
  $("authPassword").autocomplete=mode==="signin"?"current-password":"new-password";
  $("authPassword").placeholder=mode==="signin"?"Ton mot de passe":"Au moins 6 caractères";
  $("authLead").textContent=mode==="signin"
    ?"Connecte-toi avec ton adresse e-mail. Si tu n’as pas encore de compte, choisis « Créer un compte »."
    :"Crée ton compte gratuitement pour synchroniser tes favoris, publier des avis et accéder à tes espaces autorisés.";
  $("authModeHint").textContent=mode==="signin"
    ?"Entre les identifiants utilisés lors de la création de ton compte."
    :"Choisis un mot de passe d’au moins 6 caractères. Un e-mail de confirmation peut être demandé.";
  $("authMessage").textContent="";
  $("resendConfirmBtn")?.classList.add("hidden");
  lastUnconfirmedEmail="";
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
      await loadNotifications();
      subscribeToNotifications();
      await loadPushDeviceState();
    }else{
      clearNotificationState();
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
  if(isAdmin && new URLSearchParams(location.search).get("admin")==="1")setTimeout(openAdmin,0);
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
  const [iconUrls,sizes]=await Promise.all([
    signedUrlMap("gendarmerie-apps",rows.map(x=>x.logo_path),300),
    Promise.all(rows.map(row=>storageFileSize("gendarmerie-apps",row.apk_path)))
  ]);
  return rows.map((row,index)=>({
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
    sizeBytes:Number(sizes[index]||0),
    downloads:0,
    icon:iconUrls.get(row.logo_path)||"",
    screenshots:[],
    published:row.created_at,
    versions:[{version:row.version||"—",apkPath:row.apk_path,apkBucket:"gendarmerie-apps",sizeBytes:Number(sizes[index]||0),source:"supabase",published:row.created_at,changes:[]}]
  }));
}

function renderPrivateApps(){
  const box=$("privateApps");
  if(!privateApps.length){
    box.innerHTML='<div class="empty-state">Aucune application Gendarmerie publiée.</div>';
    return;
  }

  box.innerHTML=privateApps.map(a=>`
    <article class="card app-card private-card">
      <div class="head">${iconHtml(a)}<div>
          <h3>${esc(a.name)}</h3>
          <p class="app-publisher-name">Mada Apps • Espace protégé</p>
          <p class="meta">Version ${esc(a.version)}</p>
          <div class="detail-badges"><span class="private-badge">Gendarmerie</span><span class="category-badge">${esc(a.category||"Privé")}</span></div>
        </div></div>
      ${appFactsHtml(a,reviewStats[a.id]||{avg:0,count:0})}
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
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeNotifications();closeUserMenu();closeModal();closeAuth();closeProfile();closeReport();closeAdmin()}});
document.addEventListener("click",e=>{
  const wrap=$("userMenuWrap");
  if(e.target.closest?.("#mobileAccountBtn"))return;
  if(currentUser && wrap && !wrap.contains(e.target))closeUserMenu();
});

$("loginFromReviewBtn").addEventListener("click",()=>{setAuthMode("signin");openAuth()});
$("signInTab").addEventListener("click",()=>setAuthMode("signin"));
$("signUpTab").addEventListener("click",()=>setAuthMode("signup"));

$("authForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const email=$("authEmail").value.trim(),password=$("authPassword").value;
  const msg=$("authMessage");msg.className="form-message";msg.textContent="Traitement…";
  let result;

  if(authMode==="signin"){
    result=await sb.auth.signInWithPassword({email,password});

    if(result.error){
      if(result.error.message.includes("Email not confirmed")){
        lastUnconfirmedEmail=email;
        $("resendConfirmBtn")?.classList.remove("hidden");
        msg.className="form-message error";
        msg.textContent="⚠️ Votre e-mail n’est pas encore confirmé. Vérifiez votre boîte mail ou renvoyez le lien de confirmation.";
        return;
      }

      msg.className="form-message error";
      msg.textContent=result.error.message;
      return;
    }

  }else{
    result=await sb.auth.signUp({
      email,
      password,
      options:{
        emailRedirectTo:location.origin,
        data:{display_name:email.split("@")[0]}
      }
    });

    if(result.error){
      msg.className="form-message error";
      msg.textContent=result.error.message;
      return;
    }
  }
  if(authMode==="signup"&&!result.data.session){msg.className="form-message success";msg.textContent="Compte créé. Vérifie ton e-mail pour confirmer l'inscription.";return}
  msg.className="form-message success";msg.textContent="Connexion réussie.";
  setTimeout(closeAuth,500);
});

$("resendConfirmBtn")?.addEventListener("click",async()=>{
  const email=lastUnconfirmedEmail||$("authEmail").value.trim();
  const msg=$("authMessage");
  if(!email){msg.className="form-message error";msg.textContent="Indique d’abord ton adresse e-mail.";return}
  $("resendConfirmBtn").disabled=true;
  msg.className="form-message";msg.textContent="Envoi du lien…";
  const {error}=await sb.auth.resend({type:"signup",email,options:{emailRedirectTo:location.origin+location.pathname}});
  $("resendConfirmBtn").disabled=false;
  if(error){msg.className="form-message error";msg.textContent=error.message;return}
  msg.className="form-message success";msg.textContent="E-mail de confirmation renvoyé. Vérifie aussi le dossier spam.";
});

$("signOutBtn").addEventListener("click",async()=>{await disablePushNotifications({silent:true});await sb.auth.signOut();closeAuth()});
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
  localStorage.setItem(FAVORITES_KEY,JSON.stringify([...favorites]));
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
      adminCatalog.push({id:row.slug,name:row.name,version:row.version,sizeBytes:Number(row.apk_size_bytes||0),downloads:Number(row.download_count||0),visibility:row.visibility,status:row.status});
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
      <div class="mini-stat">⬇ ${Number(app.downloads||0).toLocaleString("fr-FR")} • ${esc(formatBytes(app.sizeBytes))}</div>
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
  loadDeveloperSubmissionsAdmin();
}
function closeAdmin(){
  if(isPublisherSubmitting)return;
  $("adminModal").classList.remove("show");
  $("adminModal").setAttribute("aria-hidden","true");
  document.body.classList.remove("modal-open");
  closePublisherForm();
}

$("profileBtn").addEventListener("click",event=>{
  event.stopPropagation();
  if(currentUser){toggleUserMenu();return}
  setAuthMode("signin");
  openAuth();
});
$("heroLoginBtn")?.addEventListener("click",()=>{
  if(currentUser){
    document.querySelector(".topbar")?.scrollIntoView({behavior:"smooth",block:"start"});
    setTimeout(openUserMenu,250);
    return;
  }
  setAuthMode("signin");
  openAuth();
});
$("heroBrowseBtn")?.addEventListener("click",()=>document.querySelector(".store-tabs")?.scrollIntoView({behavior:"smooth",block:"start"}));
$("helpBtn")?.addEventListener("click",()=>{
  const guide=$("gettingStarted");
  if(guide?.classList.contains("hidden")&&!currentUser){
    localStorage.removeItem("madaapps_hide_beginner_guide");
    guide.classList.remove("hidden");
  }
  (guide&&!guide.classList.contains("hidden")?guide:document.querySelector(".quick-help"))?.scrollIntoView({behavior:"smooth",block:"center"});
});
$("guideLoginBtn")?.addEventListener("click",()=>{setAuthMode("signin");openAuth()});
$("guideSignupBtn")?.addEventListener("click",()=>{setAuthMode("signup");openAuth()});
$("guideBrowseBtn")?.addEventListener("click",()=>document.querySelector(".store-tabs")?.scrollIntoView({behavior:"smooth",block:"start"}));
$("dismissGuideBtn")?.addEventListener("click",()=>{
  localStorage.setItem("madaapps_hide_beginner_guide","1");
  $("gettingStarted")?.classList.add("hidden");
});
$("togglePasswordBtn")?.addEventListener("click",()=>{
  const input=$("authPassword");
  const reveal=input.type==="password";
  input.type=reveal?"text":"password";
  $("togglePasswordBtn").textContent=reveal?"Masquer":"Afficher";
  $("togglePasswordBtn").setAttribute("aria-label",reveal?"Masquer le mot de passe":"Afficher le mot de passe");
  $("togglePasswordBtn").setAttribute("aria-pressed",reveal?"true":"false");
});
$("mobileHomeBtn")?.addEventListener("click",()=>{
  closeUserMenu();
  currentStoreTab="home";
  refreshStoreView();
  window.scrollTo({top:0,behavior:"smooth"});
});
$("mobileAppsBtn")?.addEventListener("click",()=>{
  closeUserMenu();
  currentStoreTab="all";
  refreshStoreView();
  document.querySelector(".store-tabs")?.scrollIntoView({behavior:"smooth",block:"start"});
});
$("mobileFavoritesBtn")?.addEventListener("click",()=>{
  closeUserMenu();
  currentStoreTab="favorites";
  refreshStoreView();
  document.querySelector(".store-tabs")?.scrollIntoView({behavior:"smooth",block:"start"});
});
$("mobileAccountBtn")?.addEventListener("click",()=>{
  if(currentUser){
    toggleUserMenu();
    return;
  }
  setAuthMode("signin");
  openAuth();
});
$("notificationsBtn")?.addEventListener("click",()=>openNotifications());
$("menuNotificationsBtn")?.addEventListener("click",()=>{
  closeUserMenu();
  openNotifications();
});
$("closeNotificationsBtn")?.addEventListener("click",closeNotifications);
$("notificationsBackdrop")?.addEventListener("click",closeNotifications);
$("pushNotificationsBtn")?.addEventListener("click",togglePushNotifications);
$("installPwaBtn")?.addEventListener("click",installMadaPwa);
$("markAllNotificationsBtn")?.addEventListener("click",markAllNotificationsRead);
$("notificationsList")?.addEventListener("click",e=>{
  const button=e.target.closest("[data-notification-id]");
  if(!button)return;
  const item=notifications.find(row=>row.id===button.dataset.notificationId);
  if(item)openNotificationTarget(item);
});
$("menuProfileBtn")?.addEventListener("click",()=>{
  closeUserMenu();
  openProfile();
});
$("menuFavoritesBtn")?.addEventListener("click",()=>{
  closeUserMenu();
  currentStoreTab="favorites";
  refreshStoreView();
  document.querySelector(".store-tabs")?.scrollIntoView({behavior:"smooth",block:"start"});
});
$("headerSignOutBtn")?.addEventListener("click",async()=>{
  closeUserMenu();
  await disablePushNotifications({silent:true});
  await sb.auth.signOut();
});
$("developerBtn")?.addEventListener("click",()=>{closeUserMenu();location.href="developer-dashboard.html"});
$("gendarmerieBtn")?.addEventListener("click",()=>{closeUserMenu();location.href="gendarmerie.html"});
$("profileLoginBtn").addEventListener("click",()=>{closeProfile();openAuth()});
$("profileSignOutBtn").addEventListener("click",async()=>{closeUserMenu();await disablePushNotifications({silent:true});await sb.auth.signOut();closeProfile()});
$("adminBtn").addEventListener("click",()=>{closeUserMenu();openAdmin()});

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
  const provider=btn.dataset.storageProvider||"supabase";
  if(!path)return;
  btn.disabled=true;
  const old=btn.textContent;
  btn.textContent="Préparation…";
  try{
    let url=null;
    if(provider==="r2"){
      if(!window.MadaR2?.signedUrl)throw new Error("Service R2 indisponible.");
      url=await window.MadaR2.signedUrl(bucket,path,120);
      if(!url)throw new Error("URL R2 indisponible.");
    }else{
      const {data,error}=await sb.storage.from(bucket).createSignedUrl(path,120);
      if(error)throw error;
      url=data.signedUrl;
    }
    if(app)await trackDownload(app);
    location.href=url;
  }catch(err){
    const status=Number(err?.statusCode||err?.status);
    const missing=status===404||/not found|nosuchkey|introuvable/i.test(err?.message||"");
    alert(status===403
      ?"Tu n’es pas autorisé à télécharger cette application."
      :missing
        ?"Le fichier APK n’est pas encore présent. L’administrateur doit le renvoyer depuis Admin > Mise à jour."
        :"Téléchargement impossible. Vérifie ta connexion puis réessaie.");
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
      const role=u.is_admin ? "ADMIN" : (u.role|| (access==="gendarme"?"GENDARMERIE":"USER"));
      const accessLabel=u.is_admin ? "Admin" : access==="gendarme" ? "Gendarmerie" : "Public";
      const roleLabel={USER:"Utilisateur",DEVELOPER:"Développeur",GENDARMERIE:"Gendarmerie",ADMIN:"Admin"}[role]||role;
      const controls=u.is_admin ? '' : `
        <div class="user-role-actions">
          <button class="secondary-btn" type="button" data-set-role="${esc(u.id)}" data-next-role="${role==="DEVELOPER"?"USER":"DEVELOPER"}">
            ${role==="DEVELOPER"?"Retirer Développeur":"Rendre Développeur"}
          </button>
          <button class="secondary-btn" type="button" data-set-access="${esc(u.id)}" data-next-access="${access==="gendarme"?"public":"gendarme"}">
            ${access==="gendarme"?"Retirer Gendarmerie":"Autoriser Gendarmerie"}
          </button>
        </div>`;

      return `<div class="user-access-row user-access-row-v2">
        <div class="user-access-main">
          <strong>${esc(u.display_name||"Utilisateur")}</strong>
          <div class="user-id">${esc(u.email||"")}</div>
          <div class="user-pills"><span class="access-pill">${esc(roleLabel)}</span><span class="access-pill subtle">${esc(accessLabel)}</span></div>
        </div>
        ${controls}
      </div>`;
    }).join("");
  }catch(err){
    console.error("admin_list_users:",err);
    box.innerHTML=`<p class="form-message error">Impossible de charger les comptes : ${esc(err.message||String(err))}</p>`;
  }
}

$("refreshAdminUsersBtn")?.addEventListener("click",loadAdminUsersAccess);

$("adminUsersAccess").addEventListener("click",async e=>{
  const roleBtn=e.target.closest("[data-set-role]");
  if(roleBtn){
    roleBtn.disabled=true;
    const {error}=await sb.rpc("admin_set_user_role",{target_user:roleBtn.dataset.setRole,new_role:roleBtn.dataset.nextRole});
    if(error)alert(error.message);
    await loadAdminUsersAccess();
    roleBtn.disabled=false;
    return;
  }
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


async function loadDeveloperSubmissionsAdmin(){
  if(!isAdmin)return;
  const box=$("adminDeveloperSubmissions");
  if(!box)return;
  box.innerHTML='<p class="form-message">Chargement des demandes…</p>';
  try{
    const [appsResult,versionsResult]=await Promise.all([
      sb.from("applications").select("id,slug,name,version,category,status,review_note,created_by,created_at").eq("status","pending").order("created_at",{ascending:true}),
      sb.from("app_versions").select("id,app_id,version,changes,status,review_note,created_at,applications(name,slug,status,created_by)").eq("status","pending").order("created_at",{ascending:true})
    ]);
    if(appsResult.error)throw appsResult.error;
    if(versionsResult.error)throw versionsResult.error;
    const pendingApps=appsResult.data||[];
    const pendingVersions=(versionsResult.data||[]).filter(v=>v.applications?.status==="published");
    const rows=[];
    for(const app of pendingApps){
      rows.push(`<article class="submission-card">
        <div><span class="submission-type">Nouvelle application</span><h4>${esc(app.name)}</h4><p>${esc(app.category||"Autres")} • v${esc(app.version||"—")}</p></div>
        <div class="submission-actions"><button class="primary-btn" data-review-app="${esc(app.id)}" data-decision="published">Valider</button><button class="secondary-btn danger-btn" data-review-app="${esc(app.id)}" data-decision="rejected">Refuser</button></div>
      </article>`);
    }
    for(const version of pendingVersions){
      rows.push(`<article class="submission-card">
        <div><span class="submission-type">Nouvelle version</span><h4>${esc(version.applications?.name||"Application")}</h4><p>Version ${esc(version.version)}${version.changes?.length?" • "+esc(version.changes.join(" · ")):""}</p></div>
        <div class="submission-actions"><button class="primary-btn" data-review-version="${esc(version.id)}" data-decision="published">Valider</button><button class="secondary-btn danger-btn" data-review-version="${esc(version.id)}" data-decision="rejected">Refuser</button></div>
      </article>`);
    }
    box.innerHTML=rows.length?rows.join(""):'<p class="form-message success">Aucune publication développeur en attente.</p>';
  }catch(err){
    console.error("developer submissions",err);
    box.innerHTML=`<p class="form-message error">Impossible de charger les demandes : ${esc(err.message||String(err))}</p>`;
  }
}

$("refreshDeveloperSubmissionsBtn")?.addEventListener("click",loadDeveloperSubmissionsAdmin);
$("adminDeveloperSubmissions")?.addEventListener("click",async e=>{
  const appBtn=e.target.closest("[data-review-app]");
  const versionBtn=e.target.closest("[data-review-version]");
  const btn=appBtn||versionBtn;
  if(!btn)return;
  btn.disabled=true;
  const decision=btn.dataset.decision;
  const refusal=decision==="rejected"?prompt("Motif du refus (facultatif) :","")||"":null;
  const request=appBtn
    ? sb.rpc("admin_review_application",{target_app:appBtn.dataset.reviewApp,decision,review_message:refusal})
    : sb.rpc("admin_review_version",{target_version:versionBtn.dataset.reviewVersion,decision,review_message:refusal});
  const {error}=await request;
  if(error)alert(error.message);
  await Promise.all([loadDeveloperSubmissionsAdmin(),loadAdminPublisher(),loadApps()]);
  btn.disabled=false;
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
        <small>Version ${esc(app.version)} • ${esc(formatBytes(app.sizeBytes))} • publication GitHub</small>
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
      const state={published:"Publiée",draft:"Brouillon",pending:"En validation",rejected:"Refusée"}[app.status]||app.status;
      return `<div class="publisher-app-row">
        <div class="publisher-app-main">
          <strong>${esc(app.name)}</strong>
          <small>Version ${esc(app.version||"—")} • ${esc(formatBytes(app.apk_size_bytes))} • ${esc(app.category||"Autres")}</small>
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
    .select("id,slug,name,version,category,description,changes,visibility,status,icon_path,icon_storage_provider,apk_path,apk_storage_provider,download_count,published_at,updated_at,created_at,app_versions(id,version,apk_path,storage_provider,changes,published_at),app_screenshots(id,storage_path,storage_provider,alt_text,sort_order)")
    .order("updated_at",{ascending:false});

  if(error){
    const schemaMissing=isMissingPublisherSchema(error);
    publisherAvailable=false;
    if(schemaMissing){
      $("publisherSetupNotice").classList.remove("hidden");
      $("publisherSetupNotice").innerHTML='Exécute le fichier <code>SUPABASE_SETUP_COMPLETE_V15.sql</code> dans l’éditeur SQL de Supabase. La version V15.1 crée et sécurise les tables, les stockages privés et les règles d’accès.';
    }else{
      $("publisherSetupNotice").classList.remove("hidden");
      $("publisherSetupNotice").textContent=`Impossible de charger le centre de publication : ${error.message}`;
    }
    publisherApps=[];
    renderPublisherApps();
    return;
  }

  await hydratePublisherFileSizes(data||[]);
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
  $("publisherApkSizeHint").textContent="Stockage automatique : Cloudflare R2 si configuré, sinon Supabase. La taille est détectée automatiquement.";
}

async function showPublisherScreens(app){
  publisherScreens=[...(app?.app_screenshots||[])]
    .filter(x=>x.storage_path)
    .sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  const wrap=$("publisherExistingScreens");
  if(!publisherScreens.length){wrap.innerHTML="";wrap.classList.add("hidden");return}

  const urls=await assetUrlMap(
    "app-screenshots",
    publisherScreens.map(x=>({
      path:x.storage_path,
      provider:x.storage_provider||"supabase"
    })),
    1200
  );

  wrap.innerHTML=publisherScreens.map((screen,index)=>`
    <div class="publisher-screen-item">
      <img src="${esc(urls.get(screen.storage_path)||"")}" alt="Capture ${index+1}">
      <button
        type="button"
        data-delete-publisher-screen="${esc(screen.id)}"
        data-screen-path="${esc(screen.storage_path)}"
        data-screen-provider="${esc(screen.storage_provider||"supabase")}"
        aria-label="Supprimer cette capture">×</button>
    </div>`).join("");
  wrap.classList.remove("hidden");
}

function openPublisherForm(mode,app=null){
  if(!publisherAvailable){
    $("publisherSetupNotice").classList.remove("hidden");
    $("publisherSetupNotice").innerHTML='Active d’abord le centre avec <code>SUPABASE_SETUP_COMPLETE_V15.sql</code> (V15.1).';
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

const publisherWait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function isPublisherNetworkError(error){
  const message=String(error?.message||error||"");
  return /failed to fetch|networkerror|network error|load failed|fetch failed|connection|timeout|timed out/i.test(message);
}

async function verifyPublisherUpload(bucket,path){
  for(const delay of [0,500,1200]){
    if(delay)await publisherWait(delay);
    try{
      const {data,error}=await sb.storage.from(bucket).createSignedUrl(path,60);
      if(!error&&data?.signedUrl)return true;
    }catch{}
  }
  return false;
}

async function publisherAccessToken(){
  let {data:{session},error}=await sb.auth.getSession();
  if(error)throw error;

  const expiresSoon=session?.expires_at
    ? session.expires_at*1000<Date.now()+90_000
    : false;

  if(session&&expiresSoon){
    const refreshed=await sb.auth.refreshSession();
    if(refreshed.error)throw refreshed.error;
    session=refreshed.data.session;
  }

  if(!session?.access_token){
    throw new Error("Session expirée. Reconnecte-toi avant de publier.");
  }
  return session.access_token;
}

async function publisherTusUpload(bucket,path,file,contentType,endpoint,onProgress){
  if(!window.tus?.Upload){
    throw new Error("Le module d’envoi reprenable n’est pas disponible.");
  }

  const accessToken=await publisherAccessToken();

  await new Promise((resolve,reject)=>{
    const upload=new tus.Upload(file,{
      endpoint,
      retryDelays:[0,3000,5000,10000,20000],
      headers:{
        authorization:`Bearer ${accessToken}`,
        apikey:SUPABASE_KEY,
        "x-upsert":"false"
      },
      uploadDataDuringCreation:true,
      removeFingerprintOnSuccess:true,
      storeFingerprintForResuming:false,
      chunkSize:6*1024*1024,
      metadata:{
        bucketName:bucket,
        objectName:path,
        contentType,
        cacheControl:"3600"
      },
      onError:error=>reject(error instanceof Error?error:new Error(String(error))),
      onProgress:(sent,total)=>onProgress(total?Math.round(sent/total*100):0),
      onSuccess:resolve
    });
    upload.start();
  });
}

async function publisherStandardUpload(bucket,path,file,contentType,onProgress,upsert=false){
  onProgress(10);
  const {error}=await sb.storage.from(bucket).upload(path,file,{
    upsert,
    contentType,
    cacheControl:"3600"
  });
  if(error)throw error;

  onProgress(92);
  if(!await verifyPublisherUpload(bucket,path)){
    throw new Error("Le fichier a été envoyé mais sa vérification a échoué.");
  }
  onProgress(100);
}

async function uploadPublisherFile(bucket,path,file,onProgress=()=>{}){
  const contentType=file.type||(bucket==="app-apk"
    ?"application/vnd.android.package-archive"
    :"application/octet-stream");

  const r2Status=window.MadaR2?.status
    ? await window.MadaR2.status().catch(()=>({configured:false}))
    : {configured:false};

  if(r2Status?.configured&&window.MadaR2?.upload){
    try{
      setPublisherProgress(8,"Envoi vers Cloudflare R2…");
      await window.MadaR2.upload(bucket,path,file,onProgress);
      return "r2";
    }catch(error){
      console.warn("Échec R2, tentative de secours Supabase:",error);
      if(file.size>500*1024*1024){
        throw new Error(
          "L'APK dépasse 500 Mo et nécessite Cloudflare R2. " +
          String(error?.message||error||"Échec R2.")
        );
      }
      setPublisherProgress(9,"R2 indisponible — secours Supabase…");
    }
  }

  if(file.size>500*1024*1024){
    throw new Error(
      "Ce fichier dépasse 500 Mo. Configure Cloudflare R2 pour les gros APK."
    );
  }

  let lastError=null;
  const useTus=file.size>6*1024*1024&&window.tus?.Upload;

  if(useTus){
    const projectUrl=new URL(SUPABASE_URL);
    const storageHost=projectUrl.hostname.endsWith(".supabase.co")
      ? projectUrl.hostname.replace(".supabase.co",".storage.supabase.co")
      : projectUrl.hostname;

    const endpoints=[
      `${projectUrl.protocol}//${storageHost}/storage/v1/upload/resumable`,
      `${SUPABASE_URL.replace(/\/$/,"")}/storage/v1/upload/resumable`
    ];

    for(let index=0;index<endpoints.length;index++){
      try{
        setPublisherProgress(
          Math.max(2,Math.round(index/endpoints.length*8)),
          index===0?"Connexion au stockage Supabase…":"Nouvelle tentative Supabase…"
        );

        await publisherTusUpload(
          bucket,
          path,
          file,
          contentType,
          endpoints[index],
          onProgress
        );

        if(await verifyPublisherUpload(bucket,path)){
          onProgress(100);
          return "supabase";
        }
        throw new Error("Envoi terminé mais fichier non vérifiable.");
      }catch(error){
        lastError=error;
        console.warn("Échec TUS publication",endpoints[index],error);

        if(await verifyPublisherUpload(bucket,path)){
          onProgress(100);
          return "supabase";
        }

        if(!isPublisherNetworkError(error)&&index===0){
          throw error;
        }
        await publisherWait(700);
      }
    }
  }

  try{
    setPublisherProgress(10,"Envoi sécurisé via Supabase…");
    await publisherStandardUpload(
      bucket,
      path,
      file,
      contentType,
      onProgress,
      useTus
    );
    return "supabase";
  }catch(error){
    lastError=error;
    console.warn("Échec upload standard publication",error);

    if(await verifyPublisherUpload(bucket,path)){
      onProgress(100);
      return "supabase";
    }

    if(isPublisherNetworkError(error)){
      await publisherWait(1200);
      try{
        setPublisherProgress(12,"Connexion instable — nouvelle tentative…");
        await publisherStandardUpload(
          bucket,
          path,
          file,
          contentType,
          onProgress,
          true
        );
        return "supabase";
      }catch(secondError){
        lastError=secondError;
        if(await verifyPublisherUpload(bucket,path)){
          onProgress(100);
          return "supabase";
        }
      }
    }
  }

  const detail=String(lastError?.message||lastError||"Erreur inconnue");
  if(isPublisherNetworkError(lastError)){
    throw new Error(
      "Impossible de joindre le stockage. Vérifie la connexion Internet puis réessaie. " +
      "La publication n’a pas été enregistrée. Détail : " + detail
    );
  }

  throw lastError||new Error("Échec de l’envoi du fichier.");
}

function validatePublisherFiles(icon,screens){
  const imageTypes=["image/png","image/jpeg","image/webp"];
  if(icon&&(!imageTypes.includes(icon.type)||icon.size>5*1024*1024))throw new Error("Le logo doit être une image PNG, JPG ou WebP de 5 Mo maximum.");
  for(const screen of screens){
    if(!imageTypes.includes(screen.type)||screen.size>10*1024*1024)throw new Error("Chaque capture doit être une image PNG, JPG ou WebP de 10 Mo maximum.");
  }
}

async function uploadPublisherMedia(appId,icon,screens,progressStart=75,uploadedObjects=[]){
  let iconPath=null;
  let iconProvider="supabase";
  const screenFiles=[];
  const total=(icon?1:0)+screens.length;
  let done=0;

  if(icon){
    iconPath=`${appId}/icon/${Date.now()}-${safeFileName(icon.name)}`;
    iconProvider=await uploadPublisherFile(
      "app-icons",
      iconPath,
      icon,
      p=>setPublisherProgress(
        progressStart+((done+p/100)/Math.max(total,1))*(98-progressStart),
        "Envoi du logo…"
      )
    );
    uploadedObjects.push({bucket:"app-icons",path:iconPath,provider:iconProvider});
    done++;
  }

  for(let i=0;i<screens.length;i++){
    const file=screens[i];
    const path=`${appId}/screens/${Date.now()}-${i}-${safeFileName(file.name)}`;
    const provider=await uploadPublisherFile(
      "app-screenshots",
      path,
      file,
      p=>setPublisherProgress(
        progressStart+((done+p/100)/Math.max(total,1))*(98-progressStart),
        `Envoi de la capture ${i+1}/${screens.length}…`
      )
    );
    uploadedObjects.push({bucket:"app-screenshots",path,provider});
    screenFiles.push({path,provider});
    done++;
  }

  return {iconPath,iconProvider,screenFiles};
}

async function cleanupPublisherObjects(objects){
  const supabaseByBucket=new Map();
  const r2Objects=[];

  for(const item of objects||[]){
    if(!item?.bucket||!item?.path)continue;
    if(item.provider==="r2"){
      r2Objects.push(item);
    }else{
      if(!supabaseByBucket.has(item.bucket))supabaseByBucket.set(item.bucket,[]);
      supabaseByBucket.get(item.bucket).push(item.path);
    }
  }

  for(const [bucket,paths] of supabaseByBucket){
    try{
      const unique=[...new Set(paths)];
      const {error}=await sb.storage.from(bucket).remove(unique);
      if(error)console.warn("Nettoyage Supabase",bucket,error.message);
    }catch(error){
      console.warn("Nettoyage Supabase",bucket,error);
    }
  }

  for(const item of r2Objects){
    try{
      await window.MadaR2?.remove?.(item.bucket,item.path);
    }catch(error){
      console.warn("Nettoyage R2",item.bucket,item.path,error);
    }
  }
}

function publisherScreenPayload(files,startOrder=0){
  return (files||[]).map((file,index)=>{
    const item=typeof file==="string"
      ? {path:file,provider:"supabase"}
      : file;
    return {
      storage_path:item.path,
      storage_provider:item.provider||"supabase",
      alt_text:`Capture ${startOrder+index+1}`,
      sort_order:startOrder+index
    };
  });
}

async function insertPublisherScreens(appId,paths,startOrder=0){
  if(!paths.length)return;
  const rows=paths.map((storage_path,index)=>({
    app_id:appId,
    storage_path,
    alt_text:`Capture ${startOrder+index+1}`,
    sort_order:startOrder+index,
    created_by:currentUser.id
  }));
  const {data,error}=await sb.from("app_screenshots").insert(rows).select("id");
  if(error)throw error;
  if((data||[]).length!==rows.length)throw new Error("Les captures ont été envoyées, mais leur enregistrement en base a échoué.");
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

  const mode=$("publisherMode").value;
  const appId=mode==="create"?makeId():$("publisherAppId").value;
  const current=mode==="create"?null:publisherRowById(appId);
  const msg=$("publisherMessage");
  const icon=$("publisherIcon").files?.[0]||null;
  const screens=[...($("publisherScreenshots").files||[])];
  const apk=$("publisherApk").files?.[0]||null;
  const version=$("publisherVersion").value.trim();
  const changes=linesToArray($("publisherChanges").value);
  const uploadedObjects=[];
  let committed=false;

  try{
    validatePublisherFiles(icon,screens);
  }catch(err){
    msg.className="form-message error";
    msg.textContent=err.message;
    return;
  }

  if((mode==="create"||mode==="update")&&!apk){
    msg.className="form-message error";
    msg.textContent="Choisis le fichier APK.";
    return;
  }
  if((mode==="create"||mode==="update")&&!version){
    msg.className="form-message error";
    msg.textContent="Indique le numéro de version.";
    return;
  }
  if(apk&&!/\.apk$/i.test(apk.name)){
    msg.className="form-message error";
    msg.textContent="Le fichier choisi doit être un APK.";
    return;
  }

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

      const {data:duplicate,error:duplicateError}=await sb
        .from("applications")
        .select("id")
        .eq("slug",slug)
        .maybeSingle();
      if(duplicateError)throw duplicateError;
      if(duplicate)throw new Error("Cet identifiant est déjà utilisé par une autre application.");

      const apkPath=`${appId}/versions/${slugify(version)||"version"}-${Date.now()}/${safeFileName(apk.name)}`;
      const apkProvider=await uploadPublisherFile(
        "app-apk",
        apkPath,
        apk,
        p=>setPublisherProgress(5+p*.65,`Envoi de l’APK… ${p}%`)
      );
      uploadedObjects.push({bucket:"app-apk",path:apkPath,provider:apkProvider});

      const media=await uploadPublisherMedia(appId,icon,screens,72,uploadedObjects);
      const payload={
        id:appId,
        slug,
        name,
        version,
        category:$("publisherCategory").value.trim()||"Autres",
        description:$("publisherDescription").value.trim(),
        changes,
        visibility:$("publisherVisibility").value,
        status:$("publisherStatus").value,
        icon_path:media.iconPath,
        icon_storage_provider:media.iconProvider,
        apk_path:apkPath,
        apk_storage_provider:apkProvider
      };

      const {error}=await sb.rpc("admin_publish_application_v2",{
        p_payload:payload,
        p_screens:publisherScreenPayload(media.screenFiles,0)
      });
      if(error)throw error;
      committed=true;
    }else if(mode==="edit"){
      if(!current)throw new Error("Application introuvable. Actualise le tableau de bord.");

      const media=await uploadPublisherMedia(appId,icon,screens,20,uploadedObjects);
      const payload={
        app_id:appId,
        name:$("publisherName").value.trim(),
        category:$("publisherCategory").value.trim()||"Autres",
        description:$("publisherDescription").value.trim(),
        visibility:$("publisherVisibility").value,
        status:$("publisherStatus").value,
        icon_path:media.iconPath,
        icon_storage_provider:media.iconProvider
      };

      const {data,error}=await sb.rpc("admin_edit_application_v2",{
        p_payload:payload,
        p_screens:publisherScreenPayload(
          media.screenFiles,
          nextPublisherScreenOrder(current)
        )
      });
      if(error)throw error;
      committed=true;

      if(data?.replacedIconPath){
        await cleanupPublisherObjects([{
          bucket:"app-icons",
          path:data.replacedIconPath,
          provider:data.replacedIconProvider||"supabase"
        }]);
      }
    }else{
      if(!current)throw new Error("Application introuvable. Actualise le tableau de bord.");

      const apkPath=`${appId}/versions/${slugify(version)||"version"}-${Date.now()}/${safeFileName(apk.name)}`;
      const apkProvider=await uploadPublisherFile(
        "app-apk",
        apkPath,
        apk,
        p=>setPublisherProgress(5+p*.65,`Envoi de l’APK… ${p}%`)
      );
      uploadedObjects.push({bucket:"app-apk",path:apkPath,provider:apkProvider});

      const media=await uploadPublisherMedia(appId,icon,screens,72,uploadedObjects);
      const payload={
        app_id:appId,
        version,
        apk_path:apkPath,
        storage_provider:apkProvider,
        changes,
        icon_path:media.iconPath,
        icon_storage_provider:media.iconProvider
      };

      const {data,error}=await sb.rpc("admin_publish_version_v2",{
        p_payload:payload,
        p_screens:publisherScreenPayload(
          media.screenFiles,
          nextPublisherScreenOrder(current)
        )
      });
      if(error)throw error;
      committed=true;

      const obsolete=[];
      if(data?.replacedApkPath)obsolete.push({
        bucket:"app-apk",
        path:data.replacedApkPath,
        provider:data.replacedApkProvider||"supabase"
      });
      if(data?.replacedIconPath)obsolete.push({
        bucket:"app-icons",
        path:data.replacedIconPath,
        provider:data.replacedIconProvider||"supabase"
      });
      if(obsolete.length)await cleanupPublisherObjects(obsolete);
    }

    const successText=
      mode==="update"
        ?"La version et son APK sont enregistrés."
        :mode==="edit"
          ?"La configuration est enregistrée."
          :"L’application est publiée.";

    await refreshAfterPublisherChange();
    const refreshed=publisherRowById(appId);
    if(refreshed)openPublisherForm(mode==="create"?"edit":mode,refreshed);

    setPublisherProgress(100,"Publication terminée.");
    msg.className="form-message success";
    msg.textContent=successText;
  }catch(err){
    console.error("Publication:",err);

    if(!committed&&uploadedObjects.length){
      await cleanupPublisherObjects(uploadedObjects);
    }

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
$("publisherApk").addEventListener("change",e=>{
  const file=e.currentTarget.files?.[0];
  $("publisherApkSizeHint").textContent=file
    ?`Taille détectée : ${formatBytes(file.size)} • ${file.name}`
    :"Le fichier est envoyé dans l’espace sécurisé Supabase. Sa taille sera détectée automatiquement.";
});
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
  const data={title:`${currentApp.name} — ${STORE_NAME}`,text:`Découvre ${currentApp.name} sur ${STORE_NAME}`,url};
  try{
    if(navigator.share)await navigator.share(data);
    else{await navigator.clipboard.writeText(url);alert("Lien de l’application copié.")}
  }catch{}
});
function applyStoreTheme(dark){
  document.body.classList.toggle("dark",dark);
  $("themeBtn").textContent=dark?"☀":"☾";
  $("themeBtn").setAttribute("aria-label",dark?"Activer le thème clair":"Activer le thème sombre");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content",dark?"#111418":"#f8f9fa");
}
window.addEventListener("beforeinstallprompt",event=>{
  event.preventDefault();
  deferredInstallPrompt=event;
  refreshPwaInstallUI();
});
window.addEventListener("appinstalled",()=>{
  deferredInstallPrompt=null;
  refreshPwaInstallUI();
});
registerMadaServiceWorker().catch(error=>console.warn("Service Worker:",error));
refreshPwaInstallUI();

applyStoreTheme(localStorage.getItem("madaapps_theme")==="dark");
$("themeBtn").addEventListener("click",()=>{
  const dark=!document.body.classList.contains("dark");
  localStorage.setItem("madaapps_theme",dark?"dark":"light");
  applyStoreTheme(dark);
});
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
