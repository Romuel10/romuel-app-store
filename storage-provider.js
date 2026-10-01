(function(){
  const STATUS_TTL=60000;
  const MULTIPART_THRESHOLD=100*1024*1024;
  const MIN_PART_SIZE=5*1024*1024;
  const DEFAULT_PART_SIZE=16*1024*1024;
  const MAX_PARTS=10000;
  let statusCache=null;
  let statusAt=0;

  function errMessage(error,fallback="Erreur de stockage"){
    return String(error?.message||error?.context?.message||fallback);
  }

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

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

  function putPart(url,blob,onProgress=()=>{}){
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open("PUT",url,true);
      xhr.upload.onprogress=event=>{
        if(event.lengthComputable)onProgress(event.loaded,event.total);
      };
      xhr.onerror=()=>reject(new Error("Connexion interrompue pendant un bloc R2."));
      xhr.ontimeout=()=>reject(new Error("Délai d'envoi d'un bloc R2 dépassé."));
      xhr.onload=()=>{
        if(xhr.status>=200&&xhr.status<300){
          const etag=xhr.getResponseHeader("ETag");
          if(!etag){
            reject(new Error("ETag R2 absent. Vérifie la règle CORS ExposeHeaders."));
            return;
          }
          resolve(etag);
        }else{
          reject(new Error("Bloc R2 refusé (HTTP "+xhr.status+")."));
        }
      };
      xhr.timeout=15*60*1000;
      xhr.send(blob);
    });
  }

  function multipartPartSize(fileSize){
    const minimumForPartCount=Math.ceil(fileSize/MAX_PARTS);
    const target=Math.max(DEFAULT_PART_SIZE,minimumForPartCount,MIN_PART_SIZE);
    const mib=1024*1024;
    return Math.ceil(target/mib)*mib;
  }

  async function uploadPartWithRetry({
    bucket,path,uploadId,partNumber,blob,onProgress
  }){
    let lastError=null;
    for(let attempt=1;attempt<=4;attempt++){
      try{
        const signed=await invoke({
          action:"multipart-sign-part",
          bucket,
          path,
          uploadId,
          partNumber
        });
        const etag=await putPart(signed.url,blob,onProgress);
        return {partNumber,etag};
      }catch(error){
        lastError=error;
        if(attempt<4)await sleep(Math.min(1000*Math.pow(2,attempt-1),6000));
      }
    }
    throw lastError||new Error("Échec du bloc multipart.");
  }

  async function multipartUpload(bucket,path,file,contentType,onProgress=()=>{}){
    const partSize=multipartPartSize(file.size);
    const partCount=Math.ceil(file.size/partSize);
    if(partCount>MAX_PARTS){
      throw new Error("Le fichier nécessite trop de blocs R2.");
    }

    const created=await invoke({
      action:"multipart-create",
      bucket,
      path,
      contentType,
      size:file.size
    });
    const uploadId=created.uploadId;
    const completed=[];
    let completedBytes=0;

    try{
      for(let index=0;index<partCount;index++){
        const start=index*partSize;
        const end=Math.min(start+partSize,file.size);
        const blob=file.slice(start,end);

        const part=await uploadPartWithRetry({
          bucket,
          path,
          uploadId,
          partNumber:index+1,
          blob,
          onProgress:loaded=>{
            const totalLoaded=completedBytes+Math.min(Number(loaded)||0,blob.size);
            onProgress(Math.min(99,Math.round(totalLoaded/file.size*100)));
          }
        });

        completed.push(part);
        completedBytes=end;
        onProgress(Math.min(99,Math.round(completedBytes/file.size*100)));
      }

      await invoke({
        action:"multipart-complete",
        bucket,
        path,
        uploadId,
        parts:completed
      });
      onProgress(100);
    }catch(error){
      try{
        await invoke({action:"multipart-abort",bucket,path,uploadId});
      }catch(abortError){
        console.warn("Abandon multipart R2:",abortError);
      }
      throw error;
    }
  }

  async function upload(bucket,path,file,onProgress=()=>{}){
    const st=await status();
    if(!st?.configured)throw new Error("Cloudflare R2 n'est pas configuré.");

    const contentType=file.type||
      (bucket==="app-apk"
        ?"application/vnd.android.package-archive"
        :"application/octet-stream");

    if(file.size>MULTIPART_THRESHOLD){
      await multipartUpload(bucket,path,file,contentType,onProgress);
    }else{
      const signed=await invoke({
        action:"sign-upload",
        bucket,
        path,
        contentType,
        size:file.size
      });
      await putWithProgress(signed.url,file,contentType,onProgress);
    }

    const head=await invoke({action:"head",bucket,path});
    if(!head?.exists){
      throw new Error("Le fichier R2 a été envoyé mais sa vérification a échoué.");
    }
    if(Number(head.size||0)!==Number(file.size||0)){
      throw new Error("La taille du fichier R2 ne correspond pas au fichier envoyé.");
    }

    return {
      path,
      provider:"r2",
      size:Number(head.size||file.size||0),
      multipart:file.size>MULTIPART_THRESHOLD
    };
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
    refreshStatus:()=>status(true),
    multipartThreshold:MULTIPART_THRESHOLD
  };
})();
