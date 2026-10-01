import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "npm:@aws-sdk/client-s3@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function env(name: string) {
  return (Deno.env.get(name) || "").trim();
}

function parseKeySet(name: string) {
  try {
    return JSON.parse(env(name) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

const supabaseUrl = env("SUPABASE_URL");
const publishableKey =
  env("SUPABASE_ANON_KEY") ||
  parseKeySet("SUPABASE_PUBLISHABLE_KEYS").default ||
  "";
const secretKey =
  env("SUPABASE_SERVICE_ROLE_KEY") ||
  parseKeySet("SUPABASE_SECRET_KEYS").default ||
  "";

const r2AccountId = env("R2_ACCOUNT_ID");
const r2AccessKeyId = env("R2_ACCESS_KEY_ID");
const r2SecretAccessKey = env("R2_SECRET_ACCESS_KEY");
const r2Bucket = env("R2_BUCKET_NAME");

const configured = Boolean(
  r2AccountId && r2AccessKeyId && r2SecretAccessKey && r2Bucket
);

const allowedLogicalBuckets = new Set([
  "app-apk",
  "app-icons",
  "app-screenshots",
]);

function safePath(value: unknown) {
  const path = String(value || "").trim().replace(/^\/+/, "");
  if (
    !path ||
    path.length > 900 ||
    path.includes("..") ||
    !/^[A-Za-z0-9._\-/]+$/.test(path)
  ) {
    throw new Error("Chemin de fichier invalide");
  }
  return path;
}

function logicalBucket(value: unknown) {
  const bucket = String(value || "");
  if (!allowedLogicalBuckets.has(bucket)) {
    throw new Error("Type de stockage invalide");
  }
  return bucket;
}

function objectKey(bucket: string, path: string) {
  return `${bucket}/${path}`;
}

function r2Client() {
  if (!configured) throw new Error("Cloudflare R2 n'est pas encore configuré");
  return new S3Client({
    region: "auto",
    endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey,
    },
  });
}

function adminClient() {
  if (!secretKey) throw new Error("Clé serveur Supabase indisponible");
  return createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false },
  });
}

async function authContext(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  const admin = adminClient();

  if (!authorization || !publishableKey) {
    return {
      user: null,
      profile: {},
      adminClient: admin,
      isAdmin: false,
      isDeveloper: false,
      isGendarmerie: false,
    };
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
  } = await userClient.auth.getUser();

  if (!user) {
    return {
      user: null,
      profile: {},
      adminClient: admin,
      isAdmin: false,
      isDeveloper: false,
      isGendarmerie: false,
    };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("id,is_admin,role,access_level")
    .eq("id", user.id)
    .maybeSingle();

  return {
    user,
    profile: profile || {},
    adminClient: admin,
    isAdmin: Boolean(profile?.is_admin || profile?.role === "ADMIN"),
    isDeveloper: Boolean(
      profile?.role === "DEVELOPER" || profile?.access_level === "developer"
    ),
    isGendarmerie: Boolean(
      profile?.role === "GENDARMERIE" || profile?.access_level === "gendarme"
    ),
  };
}

async function appForAsset(
  adminClient: ReturnType<typeof createClient>,
  bucket: string,
  path: string,
) {
  if (bucket === "app-apk") {
    const { data: app } = await adminClient
      .from("applications")
      .select("id,visibility,status,created_by")
      .eq("apk_path", path)
      .eq("apk_storage_provider", "r2")
      .maybeSingle();
    if (app) return app;

    const { data: version } = await adminClient
      .from("app_versions")
      .select("app_id")
      .eq("apk_path", path)
      .eq("storage_provider", "r2")
      .limit(1)
      .maybeSingle();

    if (version?.app_id) {
      const { data: versionApp } = await adminClient
        .from("applications")
        .select("id,visibility,status,created_by")
        .eq("id", version.app_id)
        .maybeSingle();
      return versionApp || null;
    }
    return null;
  }

  if (bucket === "app-icons") {
    const { data } = await adminClient
      .from("applications")
      .select("id,visibility,status,created_by")
      .eq("icon_path", path)
      .eq("icon_storage_provider", "r2")
      .maybeSingle();
    return data || null;
  }

  const { data: screenshot } = await adminClient
    .from("app_screenshots")
    .select("app_id")
    .eq("storage_path", path)
    .eq("storage_provider", "r2")
    .limit(1)
    .maybeSingle();

  if (!screenshot?.app_id) return null;

  const { data: app } = await adminClient
    .from("applications")
    .select("id,visibility,status,created_by")
    .eq("id", screenshot.app_id)
    .maybeSingle();

  return app || null;
}

async function canRead(
  ctx: Awaited<ReturnType<typeof authContext>>,
  bucket: string,
  path: string,
) {
  const app = await appForAsset(ctx.adminClient, bucket, path);
  if (!app) return false;

  if (app.status === "published" && app.visibility === "public") return true;
  if (!ctx.user) return false;
  if (ctx.isAdmin) return true;
  if (app.created_by === ctx.user.id) return true;
  if (app.status === "published" && app.visibility === "gendarmerie" && ctx.isGendarmerie) return true;
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode invalide" }, 405);

  try {
    const ctx = await authContext(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "status") {
      return json({
        configured,
        provider: configured ? "r2" : "supabase",
        bucket: configured ? r2Bucket : null,
      });
    }

    if (!configured) {
      return json({ error: "Cloudflare R2 n'est pas encore configuré" }, 503);
    }

    const s3 = r2Client();

    if (action === "sign-upload") {
      if (!ctx.user || (!ctx.isAdmin && !ctx.isDeveloper)) {
        return json({ error: "Rôle Admin ou Développeur requis" }, 403);
      }

      const bucket = logicalBucket(body?.bucket);
      const path = safePath(body?.path);
      const contentType = String(body?.contentType || "application/octet-stream");
      const size = Number(body?.size || 0);

      if (size <= 0 || size > 5 * 1024 * 1024 * 1024) {
        return json({ error: "Taille de fichier invalide" }, 400);
      }

      const command = new PutObjectCommand({
        Bucket: r2Bucket,
        Key: objectKey(bucket, path),
        ContentType: contentType,
      });

      const url = await getSignedUrl(s3, command, { expiresIn: 15 * 60 });
      return json({ url, provider: "r2", path, expiresIn: 900 });
    }

    if (action === "head") {
      if (!ctx.user || (!ctx.isAdmin && !ctx.isDeveloper)) {
        return json({ error: "Rôle Admin ou Développeur requis" }, 403);
      }

      const bucket = logicalBucket(body?.bucket);
      const path = safePath(body?.path);

      try {
        const result = await s3.send(
          new HeadObjectCommand({
            Bucket: r2Bucket,
            Key: objectKey(bucket, path),
          }),
        );
        return json({
          exists: true,
          size: Number(result.ContentLength || 0),
          etag: result.ETag || null,
          contentType: result.ContentType || null,
        });
      } catch (error) {
        const status = Number((error as any)?.$metadata?.httpStatusCode || 500);
        if (status === 404) return json({ exists: false, size: 0 });
        throw error;
      }
    }

    if (action === "delete") {
      if (!ctx.user || (!ctx.isAdmin && !ctx.isDeveloper)) {
        return json({ error: "Rôle Admin ou Développeur requis" }, 403);
      }

      const bucket = logicalBucket(body?.bucket);
      const path = safePath(body?.path);
      await s3.send(
        new DeleteObjectCommand({
          Bucket: r2Bucket,
          Key: objectKey(bucket, path),
        }),
      );
      return json({ ok: true });
    }

    if (action === "sign-download") {
      const bucket = logicalBucket(body?.bucket);
      const path = safePath(body?.path);

      if (!(await canRead(ctx, bucket, path))) {
        return json({ error: "Accès refusé" }, 403);
      }

      const expiresIn = Math.min(
        Math.max(Number(body?.expiresIn || 300), 60),
        3600,
      );
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: r2Bucket,
          Key: objectKey(bucket, path),
        }),
        { expiresIn },
      );

      return json({ url, provider: "r2", expiresIn });
    }

    if (action === "sign-download-batch") {
      const items = Array.isArray(body?.items) ? body.items.slice(0, 100) : [];
      const expiresIn = Math.min(
        Math.max(Number(body?.expiresIn || 300), 60),
        3600,
      );

      const results = await Promise.all(
        items.map(async (item: any) => {
          try {
            const bucket = logicalBucket(item?.bucket);
            const path = safePath(item?.path);
            if (!(await canRead(ctx, bucket, path))) {
              return { bucket, path, url: null, error: "Accès refusé" };
            }
            const url = await getSignedUrl(
              s3,
              new GetObjectCommand({
                Bucket: r2Bucket,
                Key: objectKey(bucket, path),
              }),
              { expiresIn },
            );
            return { bucket, path, url };
          } catch (error) {
            return {
              bucket: String(item?.bucket || ""),
              path: String(item?.path || ""),
              url: null,
              error: String((error as Error)?.message || error),
            };
          }
        }),
      );

      return json({ results });
    }

    return json({ error: "Action inconnue" }, 400);
  } catch (error) {
    console.error("r2-storage", error);
    return json({ error: String((error as Error)?.message || error) }, 500);
  }
});
