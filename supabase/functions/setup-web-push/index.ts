import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { generateVapidKeys } from "npm:@mmmike/web-push@1.0.1/vapid";

function adminKey(): string {
  const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(legacy)return legacy;
  const raw=Deno.env.get("SUPABASE_SECRET_KEYS");
  if(!raw)throw new Error("No Supabase admin key available");
  const keys=JSON.parse(raw);
  if(!keys.default)throw new Error("Default Supabase secret key is missing");
  return keys.default;
}

const supabase=createClient(
  Deno.env.get("SUPABASE_URL")!,
  adminKey(),
  {auth:{persistSession:false,autoRefreshToken:false}}
);

export default {
  fetch: async (req: Request) => {
    if(req.method!=="POST")return Response.json({error:"Method not allowed"},{status:405});

    const {data:existing,error:existingError}=await supabase.rpc("get_web_push_config_internal");
    if(existingError)return Response.json({error:"Unable to read push configuration"},{status:500});

    const row=Array.isArray(existing)?existing[0]:existing;
    if(row?.public_key&&row?.private_key&&row?.internal_token){
      return Response.json({publicKey:row.public_key,initialized:true});
    }

    const vapid=await generateVapidKeys();
    const token=crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","");

    const {error:storeError}=await supabase.rpc("store_web_push_config_internal",{
      p_public_key:vapid.publicKey,
      p_private_key:vapid.privateKey,
      p_internal_token:token
    });

    if(storeError)return Response.json({error:"Unable to store push configuration"},{status:500});
    return Response.json({publicKey:vapid.publicKey,initialized:false});
  }
};