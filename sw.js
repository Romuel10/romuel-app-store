const CACHE_NAME="mada-apps-v15.7";
const CORE_ASSETS=[
  "./",
  "./index.html",
  "./style.css?v=15.7",
  "./script.js?v=15.7",
  "./manifest.webmanifest?v=15.7"
];

self.addEventListener("install",event=>{
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(CORE_ASSETS))
      .catch(()=>undefined)
  );
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys=>Promise.all(
        keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key))
      )),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;

  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  if(request.mode==="navigate"){
    event.respondWith(
      fetch(request)
        .then(response=>{
          const copy=response.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put("./index.html",copy)).catch(()=>{});
          return response;
        })
        .catch(()=>caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response=>{
        if(response.ok){
          const copy=response.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put(request,copy)).catch(()=>{});
        }
        return response;
      })
      .catch(()=>caches.match(request))
  );
});

self.addEventListener("push",event=>{
  let data={};
  try{
    data=event.data?.json?.()||{};
  }catch{
    try{data={body:event.data?.text?.()||""}}catch{}
  }

  const title=data.title||"Mada Apps";
  const targetUrl=new URL(data.url||"./",self.registration.scope).href;
  const icon=new URL("./icons/mada-apps-192.png",self.registration.scope).href;
  const badge=new URL("./icons/mada-apps-badge-96.png",self.registration.scope).href;

  const options={
    body:data.body||"Une nouvelle mise à jour est disponible.",
    tag:data.tag||"mada-apps-update",
    renotify:true,
    icon,
    badge,
    data:{url:targetUrl}
  };

  event.waitUntil((async()=>{
    await self.registration.showNotification(title,options);
    try{
      if("setAppBadge" in self.registration)await self.registration.setAppBadge(1);
    }catch{}
  })());
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const targetUrl=event.notification.data?.url||self.registration.scope;

  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of windows){
      try{
        if(new URL(client.url).origin===new URL(targetUrl).origin){
          if("navigate" in client)await client.navigate(targetUrl);
          return client.focus();
        }
      }catch{}
    }
    return self.clients.openWindow(targetUrl);
  })());
});
