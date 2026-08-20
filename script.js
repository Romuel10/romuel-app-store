const GITHUB_OWNER = "Romuel10";
const RELEASES_REPO = "romuel-apps-releases-";

const releasesApiUrl =
  `https://api.github.com/repos/${GITHUB_OWNER}/${RELEASES_REPO}/releases?per_page=100`;

const appsGrid = document.getElementById("appsGrid");
const statusBox = document.getElementById("status");
const searchInput = document.getElementById("searchInput");
const refreshBtn = document.getElementById("refreshBtn");

let allApps = [];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getVersion(release) {
  const text = `${release.name || ""} ${release.tag_name || ""}`;
  const match = text.match(/v?\d+(?:\.\d+){1,3}/i);
  return match ? match[0].replace(/^v/i, "") : release.tag_name || "—";
}

function getAppName(release) {
  const title = (release.name || release.tag_name || "Application").trim();

  const cleaned = title
    .replace(/\s+[-–—]?\s*v?\d+(?:\.\d+){1,3}.*$/i, "")
    .replace(/\s+[-–—]?\s*version\s+\d+(?:\.\d+){1,3}.*$/i, "")
    .trim();

  return cleaned || title;
}

function getInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0]?.toUpperCase() || "")
    .join("");
}

function normalizeKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9à-ÿ]+/gi, "-").replace(/^-|-$/g, "");
}

function pickAsset(assets, extensions) {
  return assets.find(asset => {
    const fileName = asset.name.toLowerCase();
    return extensions.some(ext => fileName.endsWith(ext));
  });
}

function cleanDescription(body = "") {
  const firstUsefulLine = body
    .split("\n")
    .map(line => line.trim())
    .find(line => line && !line.startsWith("#"));

  return firstUsefulLine || "Application Android disponible au téléchargement.";
}

function buildAppsFromReleases(releases) {
  const sorted = [...releases]
    .filter(release => !release.draft && !release.prerelease)
    .sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));

  const latestByApp = new Map();

  for (const release of sorted) {
    const assets = release.assets || [];
    const apk = pickAsset(assets, [".apk"]);

    if (!apk) continue;

    const appName = getAppName(release);
    const key = normalizeKey(appName);

    if (latestByApp.has(key)) continue;

    const image = pickAsset(assets, [".png", ".jpg", ".jpeg", ".webp"]);

    latestByApp.set(key, {
      name: appName,
      version: getVersion(release),
      description: cleanDescription(release.body),
      iconUrl: image?.browser_download_url || "",
      apkUrl: apk.browser_download_url,
      releaseUrl: release.html_url,
      publishedAt: release.published_at || release.created_at
    });
  }

  return [...latestByApp.values()];
}

function formatDate(dateString) {
  if (!dateString) return "";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(new Date(dateString));
  } catch {
    return "";
  }
}

function renderApps(apps) {
  if (!apps.length) {
    appsGrid.innerHTML = `
      <div class="empty">
        Aucune application trouvée.
      </div>
    `;
    return;
  }

  appsGrid.innerHTML = apps.map(app => {
    const safeName = escapeHtml(app.name);
    const safeVersion = escapeHtml(app.version);
    const safeDescription = escapeHtml(app.description);
    const safeApk = escapeHtml(app.apkUrl);
    const safeRelease = escapeHtml(app.releaseUrl);
    const safeIcon = escapeHtml(app.iconUrl);
    const initials = escapeHtml(getInitials(app.name));
    const date = escapeHtml(formatDate(app.publishedAt));

    const icon = safeIcon
      ? `<img class="app-icon" src="${safeIcon}" alt="Logo ${safeName}" onerror="this.outerHTML='<div class=&quot;app-fallback&quot;>${initials}</div>'">`
      : `<div class="app-fallback">${initials}</div>`;

    return `
      <article class="app-card">
        <div class="app-head">
          ${icon}
          <div class="app-title">
            <h3>${safeName}</h3>
            <p class="meta">Version ${safeVersion}${date ? ` • ${date}` : ""}</p>
          </div>
        </div>

        <p class="description">${safeDescription}</p>

        <div class="actions">
          <a class="download-btn" href="${safeApk}" rel="noopener">
            Télécharger APK
          </a>
          <a class="details-btn" href="${safeRelease}" target="_blank" rel="noopener">
            Détails
          </a>
        </div>
      </article>
    `;
  }).join("");
}

function applySearch() {
  const query = searchInput.value.trim().toLowerCase();

  if (!query) {
    renderApps(allApps);
    return;
  }

  renderApps(
    allApps.filter(app =>
      `${app.name} ${app.version} ${app.description}`
        .toLowerCase()
        .includes(query)
    )
  );
}

async function loadApps() {
  statusBox.className = "status";
  statusBox.textContent = "Chargement des applications…";
  refreshBtn.disabled = true;

  try {
    const response = await fetch(releasesApiUrl, {
      headers: {
        "Accept": "application/vnd.github+json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`GitHub a répondu avec le code ${response.status}.`);
    }

    const releases = await response.json();
    allApps = buildAppsFromReleases(releases);

    if (!allApps.length) {
      statusBox.textContent =
        "Aucune application publiée pour le moment. Chaque Release doit contenir au moins un fichier .apk.";
    } else {
      statusBox.textContent =
        `${allApps.length} application${allApps.length > 1 ? "s" : ""} disponible${allApps.length > 1 ? "s" : ""}.`;
    }

    applySearch();
  } catch (error) {
    console.error(error);
    statusBox.className = "status error";
    statusBox.textContent =
      "Impossible de charger les applications pour le moment. Vérifie la connexion Internet et que le dépôt de Releases est public.";
    appsGrid.innerHTML = "";
  } finally {
    refreshBtn.disabled = false;
  }
}

searchInput.addEventListener("input", applySearch);
refreshBtn.addEventListener("click", loadApps);

loadApps();
