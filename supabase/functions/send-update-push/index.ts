import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { sendPushNotification, WebPushError } from "npm:@mmmike/web-push@1.3.0/send";

function adminKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) throw new Error("No Supabase admin key available");
  const keys = JSON.parse(raw);
  if (!keys.default) throw new Error("Default Supabase secret key is missing");
  return keys.default;
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  adminKey(),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function getConfig() {
  const { data, error } = await supabase.rpc("get_web_push_config_internal");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.public_key || !row?.private_key || !row?.internal_token) {
    throw new Error("Web Push is not initialized");
  }
  return row;
}

function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "fcm.googleapis.com"
      || host === "updates.push.services.mozilla.com"
      || host.endsWith(".push.services.mozilla.com")
      || host.endsWith(".push.apple.com");
  } catch {
    return false;
  }
}

async function removeExpiredSubscription(id: string) {
  const { error } = await supabase.from("push_subscriptions").delete().eq("id", id);
  if (error) console.error("Unable to delete expired push subscription", error);
}

export default {
  fetch: async (req: Request) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    let config;
    try {
      config = await getConfig();
    } catch (error) {
      console.error(error);
      return Response.json({ error: "Push configuration unavailable" }, { status: 500 });
    }

    if (req.headers.get("x-mada-push-token") !== config.internal_token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    let versionId = "";
    try {
      const body = await req.json();
      versionId = String(body?.version_id || "");
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!versionId) {
      return Response.json({ error: "version_id is required" }, { status: 400 });
    }

    const { data: version, error: versionError } = await supabase
      .from("app_versions")
      .select("id,app_id,version,changes,status,applications(id,name,slug,visibility,status)")
      .eq("id", versionId)
      .maybeSingle();

    if (versionError) {
      console.error(versionError);
      return Response.json({ error: "Unable to load version" }, { status: 500 });
    }

    if (!version || version.status !== "published") {
      return Response.json({ error: "Published version not found" }, { status: 404 });
    }

    const app = Array.isArray(version.applications)
      ? version.applications[0]
      : version.applications;

    if (!app || app.status !== "published") {
      return Response.json({ error: "Published application not found" }, { status: 404 });
    }

    const eventKey = "app_update:" + version.id;
    const { data: recipients, error: recipientsError } = await supabase
      .from("notifications")
      .select("user_id")
      .eq("event_key", eventKey);

    if (recipientsError) {
      console.error(recipientsError);
      return Response.json({ error: "Unable to load notification recipients" }, { status: 500 });
    }

    const userIds = [...new Set((recipients || []).map((row) => row.user_id).filter(Boolean))];
    if (!userIds.length) {
      return Response.json({ sent: 0, failed: 0, expired: 0, reason: "No recipients" });
    }

    const subscriptions: Array<{
      id: string;
      user_id: string;
      endpoint: string;
      p256dh: string;
      auth_key: string;
    }> = [];

    for (let offset = 0; offset < userIds.length; offset += 200) {
      const chunk = userIds.slice(offset, offset + 200);
      const { data, error } = await supabase
        .from("push_subscriptions")
        .select("id,user_id,endpoint,p256dh,auth_key")
        .eq("enabled", true)
        .in("user_id", chunk);

      if (error) {
        console.error(error);
        return Response.json({ error: "Unable to load push subscriptions" }, { status: 500 });
      }

      subscriptions.push(...(data || []));
    }

    const validSubscriptions = subscriptions.filter((row) => isAllowedPushEndpoint(row.endpoint));
    if (!validSubscriptions.length) {
      return Response.json({ sent: 0, failed: 0, expired: 0, reason: "No valid push subscriptions" });
    }

    const changeLines = Array.isArray(version.changes) ? version.changes.slice(0, 3) : [];
    const body = "La version " + version.version + " de " + app.name + " est disponible."
      + (changeLines.length ? " " + changeLines.join(" • ") : "");

    const payload = {
      title: "Mise à jour disponible : " + app.name,
      body,
      url: "./?app=" + encodeURIComponent(app.slug),
      tag: eventKey
    };

    const vapid = {
      subject: config.subject || "https://github.com/Romuel10/romuel-app-store",
      publicKey: config.public_key,
      privateKey: config.private_key
    };

    let sent = 0;
    let failed = 0;
    let expired = 0;

    for (let offset = 0; offset < validSubscriptions.length; offset += 20) {
      const batch = validSubscriptions.slice(offset, offset + 20);
      await Promise.all(batch.map(async (subscription) => {
        try {
          const delivered = await sendPushNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth_key
              }
            },
            payload,
            vapid,
            { ttl: 86400, urgency: "normal" }
          );

          if (delivered) sent += 1;
          else {
            expired += 1;
            await removeExpiredSubscription(subscription.id);
          }
        } catch (error) {
          failed += 1;
          if (error instanceof WebPushError) {
            console.error("Push delivery failed", {
              statusCode: error.statusCode,
              retryAfterMs: error.retryAfterMs
            });
          } else {
            console.error("Push delivery failed", String(error));
          }
        }
      }));
    }

    return Response.json({
      sent,
      failed,
      expired,
      subscriptions: validSubscriptions.length
    });
  }
};