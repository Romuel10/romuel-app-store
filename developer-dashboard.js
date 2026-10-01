const SUPABASE_URL=window.MADA_SUPABASE_URL;
const SUPABASE_KEY=window.MADA_SUPABASE_KEY;
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const slugify=s=>s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const safeFileName=n=>String(n||"fichier").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]+/g,"-");
const linesToArray=s=>String(s||"").split(/\r?\n/).map(x=>x.trim().replace(/^[-*•]\s*/,"")).filter(Boolean);
const makeId=()=>crypto.randomUUID();

let currentUser=null;
let profile=null;
let myApps=[];
let submitting=false;

function setProgress(percent,text){
  $("devProgressWrap").classList.remove("hidden");
  $("devProgressBar").style.width=`${Math.max(0,Math.min(100,percent))}%`;
  $("devProgressText").textContent=text;
}

async function verifyStoredFile(bucket,path){
  for(const delay of [0,500,1200]){
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    try{
      const {data,error}=await sb.storage.from(bucket).createSignedUrl(path,45);
      if(!error&&data?.signedUrl)return true;
    }catch{}
  }
  return false;
}

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function isNetworkError(error){
  const message=String(error?.message||error||"");
  return /failed to fetch|networkerror|network error|load failed|fetch failed|connection|timeout|timed out/i.test(message);
}

async function getFreshAccessToken(){
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

async function standardStorageUpload(bucket,path,file,contentType,onProgress){
  onProgress(8);
  const {error}=await sb.storage.from(bucket).upload(path,file,{
    upsert:false,
    contentType,
    cacheControl:"3600"
  });
  if(error)throw error;

  onProgress(92);
  if(!await verifyStoredFile(bucket,path)){
    throw new Error("Le fichier a été envoyé mais sa vérification a échoué.");
  }
  onProgress(100);
}

async function tusStorageUpload(bucket,path,file,contentType,endpoint,onProgress){
  if(!window.tus?.Upload){
    throw new Error("Le module d’envoi reprenable n’est pas disponible.");
  }

  const accessToken=await getFreshAccessToken();

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

async function uploadFile(bucket,path,file,onProgress=()=>{}){
  const contentType=file.type||(bucket==="app-apk"
    ?"application/vnd.android.package-archive"
    :"application/octet-stream");

  const r2Status=window.MadaR2?.status
    ? await window.MadaR2.status().catch(()=>({configured:false}))
    : {configured:false};

  if(r2Status?.configured&&window.MadaR2?.upload){
    try{
      setProgress(8,"Envoi vers Cloudflare R2…");
      await window.MadaR2.upload(bucket,path,file,onProgress);
      return "r2";
    }catch(error){
      console.warn("Échec R2, secours Supabase:",error);
      if(file.size>500*1024*1024){
        throw new Error(
          "L'APK dépasse 500 Mo et nécessite Cloudflare R2. " +
          String(error?.message||error||"Échec R2.")
        );
      }
      setProgress(9,"R2 indisponible — secours Supabase…");
    }
  }

  if(file.size>500*1024*1024){
    throw new Error(
      "Ce fichier dépasse 500 Mo. Cloudflare R2 doit être configuré pour ce gros APK."
    );
  }

  const useResumable=file.size>6*1024*1024&&window.tus?.Upload;
  let lastError=null;

  if(useResumable){
    const projectUrl=new URL(SUPABASE_URL);
    const directHost=projectUrl.hostname.endsWith(".supabase.co")
      ? projectUrl.hostname.replace(".supabase.co",".storage.supabase.co")
      : projectUrl.hostname;

    const endpoints=[
      `${projectUrl.protocol}//${directHost}/storage/v1/upload/resumable`,
      `${SUPABASE_URL.replace(/\/$/,"")}/storage/v1/upload/resumable`
    ];

    for(let index=0;index<endpoints.length;index++){
      try{
        setProgress(
          Math.max(1,Math.round((index/endpoints.length)*8)),
          index===0?"Connexion au stockage Supabase…":"Nouvelle tentative Supabase…"
        );
        await tusStorageUpload(bucket,path,file,contentType,endpoints[index],onProgress);

        if(await verifyStoredFile(bucket,path)){
          onProgress(100);
          return "supabase";
        }
        throw new Error("Envoi terminé mais fichier non vérifiable.");
      }catch(error){
        lastError=error;
        console.warn("Échec TUS",endpoints[index],error);

        if(await verifyStoredFile(bucket,path)){
          onProgress(100);
          return "supabase";
        }

        if(!isNetworkError(error)&&index===0){
          throw error;
        }
        await wait(700);
      }
    }
  }

  try{
    setProgress(10,"Envoi sécurisé via Supabase…");
    await standardStorageUpload(bucket,path,file,contentType,onProgress);
    return "supabase";
  }catch(error){
    lastError=error;
    console.warn("Échec upload standard",error);

    if(await verifyStoredFile(bucket,path)){
      onProgress(100);
      return "supabase";
    }

    if(isNetworkError(error)){
      await wait(1200);
      try{
        setProgress(12,"Connexion instable — nouvelle tentative…");
        await standardStorageUpload(bucket,path,file,contentType,onProgress);
        return "supabase";
      }catch(secondError){
        lastError=secondError;
        if(await verifyStoredFile(bucket,path)){
          onProgress(100);
          return "supabase";
        }
      }
    }
  }

  const detail=String(lastError?.message||lastError||"Erreur inconnue");
  if(isNetworkError(lastError)){
    throw new Error(
      "Impossible de joindre le stockage. Vérifie la connexion Internet puis réessaie. " +
      "La publication n’a pas été conservée. Détail : " + detail
    );
  }
  throw lastError||new Error("Échec de l’envoi du fichier.");
}

async function cleanupUploadedObjects(objects){
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
      const {error}=await sb.storage.from(bucket).remove([...new Set(paths)]);
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

function validateImages(icon,screens){
  const allowed=["image/png","image/jpeg","image/webp"];
  if(icon&&(!allowed.includes(icon.type)||icon.size>5*1024*1024)){
    throw new Error("Logo : PNG/JPG/WebP, 5 Mo maximum.");
  }
  for(const file of screens){
    if(!allowed.includes(file.type)||file.size>10*1024*1024){
      throw new Error("Chaque capture doit faire 10 Mo maximum et être PNG/JPG/WebP.");
    }
  }
}

async function bootstrap(){
  const {data:{session}}=await sb.auth.getSession();
  currentUser=session?.user||null;
  if(!currentUser){
    gate("Connexion requise","Connecte-toi d’abord sur Mada Apps, puis reviens dans la Console développeur.",false);
    return;
  }

  const {data,error}=await sb.from("profiles")
    .select("id,display_name,role,is_admin,access_level")
    .eq("id",currentUser.id)
    .maybeSingle();

  if(error){
    gate("Profil indisponible",error.message,false);
    return;
  }

  profile=data;
  const allowed=profile?.is_admin||profile?.role==="DEVELOPER";
  if(!allowed){
    gate("Accès développeur requis","Ton compte existe, mais il n’a pas encore le rôle Développeur. Un administrateur peut l’activer depuis Admin > Accès utilisateurs.",false);
    return;
  }

  $("developerGate").classList.add("hidden");
  $("developerApp").classList.remove("hidden");
  $("devIdentity").textContent=profile?.display_name||currentUser.email;
  await loadApps();
}

function gate(title,textValue,ok){
  const gateEl=$("developerGate");
  gateEl.className=`developer-gate ${ok?"success":"error"}`;
  gateEl.innerHTML=`<h2>${esc(title)}</h2><p>${esc(textValue)}</p><p><a class="primary-btn dev-link-btn" href="./index.html">Retour au Store</a></p>`;
}

async function loadApps(){
  const {data,error}=await sb.from("applications")
    .select("id,slug,name,version,category,description,status,visibility,review_note,created_at,updated_at,apk_storage_provider,icon_storage_provider,app_versions(id,version,status,review_note,created_at,apk_path,storage_provider)")
    .eq("created_by",currentUser.id)
    .order("updated_at",{ascending:false});

  if(error){
    $("developerAppsList").innerHTML=`<p class="form-message error">${esc(error.message)}</p>`;
    return;
  }

  myApps=data||[];
  renderApps();
}

function labelStatus(status){
  return {published:"Publiée",pending:"En validation",draft:"Brouillon",rejected:"Refusée"}[status]||status;
}

function renderApps(){
  $("devAppCount").textContent=myApps.length;
  $("devPublishedCount").textContent=myApps.filter(app=>app.status==="published").length;

  const pendingVersions=myApps.reduce(
    (count,app)=>count+(app.app_versions||[]).filter(version=>version.status==="pending").length,
    0
  );
  $("devPendingCount").textContent=myApps.filter(app=>app.status==="pending").length+pendingVersions;

  $("developerAppsList").innerHTML=myApps.length
    ? myApps.map(app=>{
        const pending=(app.app_versions||[]).filter(version=>version.status==="pending");
        const rejected=(app.app_versions||[]).filter(version=>version.status==="rejected");
        return `<article class="dev-app-row">
          <div class="dev-app-main">
            <h4>${esc(app.name)}</h4>
            <p>${esc(app.category||"Autres")} • version publiée ${esc(app.version||"—")}</p>
            <div class="dev-statuses">
              <span class="dev-status ${esc(app.status)}">${esc(labelStatus(app.status))}</span>
              ${pending.map(version=>`<span class="dev-status pending">v${esc(version.version)} en validation</span>`).join("")}
              ${rejected.map(version=>`<span class="dev-status rejected">v${esc(version.version)} refusée</span>`).join("")}
            </div>
            ${app.review_note?`<p class="form-message error">Motif : ${esc(app.review_note)}</p>`:""}
            ${rejected.map(version=>`<p class="form-message error">v${esc(version.version)} : ${esc(version.review_note||"mise à jour refusée")}</p>`).join("")}
          </div>
          <div class="dev-actions">
            ${app.status==="published"?`<button class="secondary-btn" data-new-version="${esc(app.id)}">＋ Nouvelle version</button>`:""}
            ${rejected.map(version=>`<button class="secondary-btn" data-retry-version="${esc(version.id)}" data-app-id="${esc(app.id)}">Corriger v${esc(version.version)}</button>`).join("")}
            ${app.status==="rejected"?`<button class="primary-btn" data-resubmit="${esc(app.id)}">Renvoyer en validation</button>`:""}
          </div>
        </article>`;
      }).join("")
    : '<p class="form-message">Tu n’as encore soumis aucune application.</p>';
}

function openCreate(){
  const form=$("developerForm");
  form.reset();
  $("devMode").value="create";
  $("devAppId").value="";
  $("devVersionId").value="";
  $("devVersion").readOnly=false;
  $("devFormEyebrow").textContent="NOUVELLE APPLICATION";
  $("devFormTitle").textContent="Soumettre une application";
  $("devMetadataFields").classList.remove("hidden");
  $("devMediaFields").classList.remove("hidden");
  $("devApk").required=true;
  $("devMessage").textContent="";
  $("devProgressWrap").classList.add("hidden");
  $("developerFormSection").classList.remove("hidden");
  $("devName").focus();
}

function openVersion(app,rejectedVersion=null){
  const form=$("developerForm");
  form.reset();
  $("devMode").value=rejectedVersion?"version-retry":"version";
  $("devAppId").value=app.id;
  $("devVersionId").value=rejectedVersion?.id||"";
  $("devVersion").readOnly=!!rejectedVersion;
  $("devFormEyebrow").textContent=rejectedVersion?"CORRECTION DE VERSION":"MISE À JOUR";
  $("devFormTitle").textContent=rejectedVersion
    ? `Corriger v${rejectedVersion.version} — ${app.name}`
    : `Nouvelle version — ${app.name}`;
  $("devMetadataFields").classList.add("hidden");
  $("devMediaFields").classList.add("hidden");
  $("devApk").required=true;
  $("devMessage").textContent="";
  $("devProgressWrap").classList.add("hidden");
  $("developerFormSection").classList.remove("hidden");
  if(rejectedVersion)$("devVersion").value=rejectedVersion.version;
  $("devVersion").focus();
}

function closeForm(){
  $("developerFormSection").classList.add("hidden");
}

$("newDevAppBtn").addEventListener("click",openCreate);
$("closeDevForm").addEventListener("click",closeForm);
$("cancelDevForm").addEventListener("click",closeForm);
$("refreshDevApps").addEventListener("click",loadApps);

$("devName").addEventListener("input",event=>{
  if($("devMode").value==="create")$("devSlug").value=slugify(event.target.value);
});

$("devApk").addEventListener("change",event=>{
  const file=event.target.files?.[0];
  $("devApkHint").textContent=file?`${file.name} • ${(file.size/1024/1024).toFixed(1)} Mo`:"APK Android.";
});

$("developerAppsList").addEventListener("click",async event=>{
  const retryButton=event.target.closest("[data-retry-version]");
  if(retryButton){
    const app=myApps.find(item=>item.id===retryButton.dataset.appId);
    const rejected=app?.app_versions?.find(item=>item.id===retryButton.dataset.retryVersion);
    if(app&&rejected)openVersion(app,rejected);
    return;
  }

  const versionButton=event.target.closest("[data-new-version]");
  if(versionButton){
    const app=myApps.find(item=>item.id===versionButton.dataset.newVersion);
    if(app)openVersion(app);
    return;
  }

  const resubmitButton=event.target.closest("[data-resubmit]");
  if(!resubmitButton)return;

  resubmitButton.disabled=true;
  const {error}=await sb.rpc("developer_resubmit_application",{target_app:resubmitButton.dataset.resubmit});
  if(error)alert(error.message);
  await loadApps();
  resubmitButton.disabled=false;
});

$("developerForm").addEventListener("submit",async event=>{
  event.preventDefault();
  if(submitting)return;

  const mode=$("devMode").value;
  const apk=$("devApk").files?.[0];
  const version=$("devVersion").value.trim();
  const changes=linesToArray($("devChanges").value);
  const message=$("devMessage");

  if(!apk||!/\.apk$/i.test(apk.name)){
    message.className="form-message error";
    message.textContent="Choisis un fichier APK valide.";
    return;
  }
  if(!version){
    message.className="form-message error";
    message.textContent="Indique le numéro de version.";
    return;
  }

  submitting=true;
  $("devSubmit").disabled=true;
  message.className="form-message";
  message.textContent="Envoi en cours…";

  try{
    if(mode==="create"){
      const icon=$("devIcon").files?.[0]||null;
      const screens=[...($("devScreens").files||[])];
      validateImages(icon,screens);

      const appId=makeId();
      const slug=slugify($("devSlug").value);
      if(!slug)throw new Error("L’identifiant de l’application est invalide.");

      const apkPath=`${appId}/versions/${slugify(version)||"version"}-${Date.now()}/${safeFileName(apk.name)}`;
      const row={
        id:appId,
        slug,
        name:$("devName").value.trim(),
        version,
        category:$("devCategory").value.trim()||"Autres",
        description:$("devDescription").value.trim(),
        changes,
        visibility:"public",
        status:"draft",
        apk_path:apkPath,
        apk_storage_provider:"supabase",
        created_by:currentUser.id
      };

      const {error:insertError}=await sb.from("applications").insert(row);
      if(insertError)throw insertError;

      const uploaded=[];
      try{
        const apkProvider=await uploadFile(
          "app-apk",
          apkPath,
          apk,
          progress=>setProgress(5+progress*.60,`Envoi APK… ${progress}%`)
        );
        uploaded.push({bucket:"app-apk",path:apkPath,provider:apkProvider});

        let iconPath=null;
        let iconProvider="supabase";
        if(icon){
          iconPath=`${appId}/icon/${Date.now()}-${safeFileName(icon.name)}`;
          iconProvider=await uploadFile(
            "app-icons",
            iconPath,
            icon,
            progress=>setProgress(66+progress*.10,`Envoi logo… ${progress}%`)
          );
          uploaded.push({bucket:"app-icons",path:iconPath,provider:iconProvider});
        }

        const screenRows=[];
        for(let index=0;index<screens.length;index++){
          const file=screens[index];
          const path=`${appId}/screens/${Date.now()}-${index}-${safeFileName(file.name)}`;
          const provider=await uploadFile(
            "app-screenshots",
            path,
            file,
            progress=>setProgress(
              77+((index+progress/100)/Math.max(1,screens.length))*18,
              `Capture ${index+1}/${screens.length}…`
            )
          );
          uploaded.push({bucket:"app-screenshots",path,provider});
          screenRows.push({
            app_id:appId,
            storage_path:path,
            storage_provider:provider,
            alt_text:`Capture ${index+1}`,
            sort_order:index,
            created_by:currentUser.id
          });
        }

        if(screenRows.length){
          const {error}=await sb.from("app_screenshots").insert(screenRows);
          if(error)throw error;
        }

        const {error:versionError}=await sb.from("app_versions").insert({
          app_id:appId,
          version,
          apk_path:apkPath,
          storage_provider:apkProvider,
          changes,
          status:"pending",
          created_by:currentUser.id
        });
        if(versionError)throw versionError;

        const finalUpdate={
          status:"pending",
          apk_storage_provider:apkProvider
        };
        if(iconPath){
          finalUpdate.icon_path=iconPath;
          finalUpdate.icon_storage_provider=iconProvider;
        }
        const {error:finalError}=await sb
          .from("applications")
          .update(finalUpdate)
          .eq("id",appId);
        if(finalError)throw finalError;
      }catch(error){
        await sb.from("app_versions")
          .delete()
          .eq("app_id",appId)
          .eq("created_by",currentUser.id);
        await sb.from("app_screenshots")
          .delete()
          .eq("app_id",appId)
          .eq("created_by",currentUser.id);
        await sb.from("applications")
          .update({
            apk_path:null,
            icon_path:null,
            apk_storage_provider:"supabase",
            icon_storage_provider:"supabase"
          })
          .eq("id",appId)
          .eq("created_by",currentUser.id);
        await cleanupUploadedObjects(uploaded);
        await sb.from("applications")
          .delete()
          .eq("id",appId)
          .eq("created_by",currentUser.id);
        throw error;
      }
    }else{
      const app=myApps.find(item=>item.id===$("devAppId").value);
      if(!app)throw new Error("Application introuvable.");
      if((app.app_versions||[]).some(item=>item.status==="pending")){
        throw new Error("Une version est déjà en attente de validation.");
      }

      const retry=mode==="version-retry";
      const rejected=retry
        ? (app.app_versions||[]).find(
            item=>item.id===$("devVersionId").value&&item.status==="rejected"
          )
        : null;

      if(retry&&!rejected){
        throw new Error("La version refusée n’est plus disponible. Actualise la page.");
      }

      if(!retry&&(app.app_versions||[]).some(item=>item.version===version)){
        throw new Error(
          "Cette version existe déjà. Si elle a été refusée, utilise le bouton « Corriger »."
        );
      }

      const path=`${app.id}/versions/${slugify(version)||"version"}-${Date.now()}/${safeFileName(apk.name)}`;
      const uploaded=[];

      try{
        const provider=await uploadFile(
          "app-apk",
          path,
          apk,
          progress=>setProgress(5+progress*.90,`Envoi APK… ${progress}%`)
        );
        uploaded.push({bucket:"app-apk",path,provider});

        if(retry){
          const {data,error}=await sb.rpc("developer_resubmit_version_v2",{
            p_payload:{
              version_id:rejected.id,
              apk_path:path,
              storage_provider:provider,
              changes
            }
          });
          if(error)throw error;

          if(data?.replacedApkPath&&data.replacedApkPath!==path){
            await cleanupUploadedObjects([{
              bucket:"app-apk",
              path:data.replacedApkPath,
              provider:data.replacedApkProvider||"supabase"
            }]);
          }
        }else{
          const {error}=await sb.from("app_versions").insert({
            app_id:app.id,
            version,
            apk_path:path,
            storage_provider:provider,
            changes,
            status:"pending",
            created_by:currentUser.id
          });
          if(error)throw error;
        }
      }catch(error){
        await cleanupUploadedObjects(uploaded);
        throw error;
      }
    }

    setProgress(100,"Envoi terminé.");
    message.className="form-message success";
    message.textContent="Publication envoyée à l’administrateur pour validation.";
    await loadApps();
    setTimeout(closeForm,900);
  }catch(error){
    console.error(error);
    message.className="form-message error";
    message.textContent=error.message||"Échec de l’envoi.";
  }finally{
    submitting=false;
    $("devSubmit").disabled=false;
  }
});

$("devSignOut").addEventListener("click",async()=>{
  await sb.auth.signOut();
  location.href="./index.html";
});

bootstrap();
