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
  for(const delay of [0,400,1000]){
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    const {data,error}=await sb.storage.from(bucket).createSignedUrl(path,45);
    if(!error&&data?.signedUrl)return true;
  }
  return false;
}

async function uploadFile(bucket,path,file,onProgress=()=>{}){
  const contentType=file.type||(bucket==="app-apk"?"application/vnd.android.package-archive":"application/octet-stream");

  if(file.size<=6*1024*1024||!window.tus){
    onProgress(15);
    const {error}=await sb.storage.from(bucket).upload(path,file,{
      upsert:false,
      contentType,
      cacheControl:"3600"
    });
    if(error)throw error;
    if(!await verifyStoredFile(bucket,path)){
      throw new Error("Le fichier envoyé n’a pas été retrouvé dans le stockage. Réessaie avec une connexion stable.");
    }
    onProgress(100);
    return path;
  }

  const {data:{session},error}=await sb.auth.getSession();
  if(error||!session)throw error||new Error("Reconnecte-toi avant l’envoi.");

  const projectUrl=new URL(SUPABASE_URL);
  const host=projectUrl.hostname.endsWith(".supabase.co")
    ? projectUrl.hostname.replace(".supabase.co",".storage.supabase.co")
    : projectUrl.hostname;

  await new Promise((resolve,reject)=>{
    new tus.Upload(file,{
      endpoint:`${projectUrl.protocol}//${host}/storage/v1/upload/resumable`,
      retryDelays:[0,3000,5000,10000,20000],
      headers:{
        authorization:`Bearer ${session.access_token}`,
        apikey:SUPABASE_KEY,
        "x-upsert":"false"
      },
      uploadDataDuringCreation:true,
      removeFingerprintOnSuccess:true,
      storeFingerprintForResuming:false,
      chunkSize:6*1024*1024,
      metadata:{bucketName:bucket,objectName:path,contentType,cacheControl:"3600"},
      onError:reject,
      onProgress:(sent,total)=>onProgress(total?Math.round(sent/total*100):0),
      onSuccess:resolve
    }).start();
  });

  if(!await verifyStoredFile(bucket,path)){
    throw new Error("L’envoi semble terminé, mais le fichier n’est pas disponible dans le stockage.");
  }
  return path;
}

async function cleanupUploadedObjects(objects){
  const byBucket=new Map();
  for(const item of objects){
    if(!item?.bucket||!item?.path)continue;
    if(!byBucket.has(item.bucket))byBucket.set(item.bucket,[]);
    byBucket.get(item.bucket).push(item.path);
  }
  for(const [bucket,paths] of byBucket){
    try{
      const {error}=await sb.storage.from(bucket).remove(paths);
      if(error)console.warn("Nettoyage Storage",bucket,error.message);
    }catch(error){
      console.warn("Nettoyage Storage",bucket,error);
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
    .select("id,slug,name,version,category,description,status,visibility,review_note,created_at,updated_at,app_versions(id,version,status,review_note,created_at)")
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
        return `<article class="dev-app-row">
          <div class="dev-app-main">
            <h4>${esc(app.name)}</h4>
            <p>${esc(app.category||"Autres")} • version publiée ${esc(app.version||"—")}</p>
            <div class="dev-statuses">
              <span class="dev-status ${esc(app.status)}">${esc(labelStatus(app.status))}</span>
              ${pending.map(version=>`<span class="dev-status pending">v${esc(version.version)} en validation</span>`).join("")}
            </div>
            ${app.review_note?`<p class="form-message error">Motif : ${esc(app.review_note)}</p>`:""}
          </div>
          <div class="dev-actions">
            ${app.status==="published"?`<button class="secondary-btn" data-new-version="${esc(app.id)}">＋ Nouvelle version</button>`:""}
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

function openVersion(app){
  const form=$("developerForm");
  form.reset();
  $("devMode").value="version";
  $("devAppId").value=app.id;
  $("devFormEyebrow").textContent="MISE À JOUR";
  $("devFormTitle").textContent=`Nouvelle version — ${app.name}`;
  $("devMetadataFields").classList.add("hidden");
  $("devMediaFields").classList.add("hidden");
  $("devApk").required=true;
  $("devMessage").textContent="";
  $("devProgressWrap").classList.add("hidden");
  $("developerFormSection").classList.remove("hidden");
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
        created_by:currentUser.id
      };

      const {error:insertError}=await sb.from("applications").insert(row);
      if(insertError)throw insertError;

      const uploaded=[];
      try{
        await uploadFile("app-apk",apkPath,apk,progress=>setProgress(5+progress*.60,`Envoi APK… ${progress}%`));
        uploaded.push({bucket:"app-apk",path:apkPath});

        let iconPath=null;
        if(icon){
          iconPath=`${appId}/icon/${Date.now()}-${safeFileName(icon.name)}`;
          await uploadFile("app-icons",iconPath,icon,progress=>setProgress(66+progress*.10,`Envoi logo… ${progress}%`));
          uploaded.push({bucket:"app-icons",path:iconPath});
        }

        const screenRows=[];
        for(let index=0;index<screens.length;index++){
          const file=screens[index];
          const path=`${appId}/screens/${Date.now()}-${index}-${safeFileName(file.name)}`;
          await uploadFile(
            "app-screenshots",
            path,
            file,
            progress=>setProgress(77+((index+progress/100)/Math.max(1,screens.length))*18,`Capture ${index+1}/${screens.length}…`)
          );
          uploaded.push({bucket:"app-screenshots",path});
          screenRows.push({
            app_id:appId,
            storage_path:path,
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
          changes,
          status:"pending",
          created_by:currentUser.id
        });
        if(versionError)throw versionError;

        const finalUpdate={status:"pending"};
        if(iconPath)finalUpdate.icon_path=iconPath;
        const {error:finalError}=await sb.from("applications").update(finalUpdate).eq("id",appId);
        if(finalError)throw finalError;
      }catch(error){
        await sb.from("app_versions").delete().eq("app_id",appId).eq("created_by",currentUser.id);
        await sb.from("app_screenshots").delete().eq("app_id",appId).eq("created_by",currentUser.id);
        await cleanupUploadedObjects(uploaded);
        await sb.from("applications").delete().eq("id",appId).eq("created_by",currentUser.id);
        throw error;
      }
    }else{
      const app=myApps.find(item=>item.id===$("devAppId").value);
      if(!app)throw new Error("Application introuvable.");
      if((app.app_versions||[]).some(item=>item.status==="pending")){
        throw new Error("Une version est déjà en attente de validation.");
      }

      const path=`${app.id}/versions/${slugify(version)||"version"}-${Date.now()}/${safeFileName(apk.name)}`;
      const uploaded=[{bucket:"app-apk",path}];
      try{
        await uploadFile("app-apk",path,apk,progress=>setProgress(5+progress*.90,`Envoi APK… ${progress}%`));
        const {error}=await sb.from("app_versions").insert({
          app_id:app.id,
          version,
          apk_path:path,
          changes,
          status:"pending",
          created_by:currentUser.id
        });
        if(error)throw error;
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
