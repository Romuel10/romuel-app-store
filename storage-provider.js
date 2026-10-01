(function(){
  const STATUS_TTL=60000;
  let statusCache=null;
  let statusAt=0;

  function errMessage(error,fallback="Erreur de stockage"){
    return String(error?.message||error?.context?.message||fallback);
  }

  async function invoke(body){
    if(!window.sb?.functions){
      throw new Error("Client Supabase indisponible.");
    }
    const {data,error}=await sb.functions.invoke("r2-storage",{body});
    if(error){
      const detail=error?.context?.body
        ? await error.context.body.text().catch(()=>"")
        : "";
      throw new Error(detail||errMessage(error));
    }
    if(data?.error)throw new Error(data.error);
    return data||{};
  }

  async function status(force=false){
    if(!force&&statusCache&&(Date.now()-statusAt)<STATUS_TTL)return statusCache;
    try{
      statusCache=await invoke({action:"status"});
    }catch(error){
      console.warn("R2 status:",error);
      statusCache={configured:false,provider:"supabase"};
    }
    statusAt=Date.now();
    return statusCache;
  }

  function putWithProgress(url,file,contentType,onProgress=()=>{}){
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open("PUT",url,true);
      xhr.setRequestHeader("Content-Type",contentType||"application/octet-stream");
      xhr.upload.onprogress=event=>{
        if(event.lengthComputable){
          onProgress(Math.round(event.loaded/event.total*100));
        }
      };
      xhr.onerror=()=>reject(new Error("Connexion interrompue pendant l'envoi R2."));
      xhr.ontimeout=()=>reject(new Error("Délai d'envoi R2 dépassé."));
      xhr.onload=()=>{
        if(xhr.status>=200&&xhr.status<300){
          onProgress(100);
          resolve();
        }else{
          reject(new Error("Cloudflare R2 a refusé l'envoi (HTTP "+xhr.status+")."));
        }
      };
      xhr.timeout=30*60*1000;
      xhr.send(file);
    });
  }

  async function upload(bucket,path,file,onProgress=()=>{}){
    const st=await status();
    if(!st?.configured)throw new Error("Cloudflare R2 n'est pas configuré.");

    const contentType=file.type||
      (bucket==="app-apk"
        ?"application/vnd.android.package-archive"
        :"application/octet-stream");

    const signed=await invoke({
      action:"sign-upload",
      bucket,
      path,
      contentType,
      size:file.size
    });

    await putWithProgress(signed.url,file,contentType,onProgress);

    const head=await invoke({action:"head",bucket,path});
    if(!head?.exists){
      throw new Error("Le fichier R2 a été envoyé mais sa vérification a échoué.");
    }
    if(Number(head.size||0)!==Number(file.size||0)){
      throw new Error("La taille du fichier R2 ne correspond pas au fichier envoyé.");
    }

    return {path,provider:"r2",size:Number(head.size||file.size||0)};
  }

  async function remove(bucket,path){
    if(!path)return;
    await invoke({action:"delete",bucket,path});
  }

  async function signedUrl(bucket,path,expiresIn=300){
    if(!path)return null;
    const data=await invoke({action:"sign-download",bucket,path,expiresIn});
    return data?.url||null;
  }

  async function signedUrls(bucket,paths,expiresIn=300){
    const unique=[...new Set((paths||[]).filter(Boolean))];
    const map=new Map();
    if(!unique.length)return map;

    const data=await invoke({
      action:"sign-download-batch",
      expiresIn,
      items:unique.map(path=>({bucket,path}))
    });
    for(const row of data?.results||[]){
      if(row?.path&&row?.url)map.set(row.path,row.url);
    }
    return map;
  }

  async function size(bucket,path){
    if(!path)return 0;
    try{
      const data=await invoke({action:"head",bucket,path});
      return data?.exists?Number(data.size||0):0;
    }catch{
      return 0;
    }
  }

  window.MadaR2={
    status,
    upload,
    remove,
    signedUrl,
    signedUrls,
    size,
    refreshStatus:()=>status(true)
  };
})();
