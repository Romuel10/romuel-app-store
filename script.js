const grid = document.getElementById('appsGrid');
const searchInput = document.getElementById('searchInput');
const filtersWrap = document.getElementById('categoryFilters');
const emptyState = document.getElementById('emptyState');
document.getElementById('year').textContent = new Date().getFullYear();

let activeCategory = 'Toutes';
const categories = ['Toutes', ...new Set(apps.map(a => a.category))];

function renderFilters(){
  filtersWrap.innerHTML = categories.map(c => `<button class="filter-btn ${c===activeCategory?'active':''}" data-category="${c}">${c}</button>`).join('');
  filtersWrap.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
    activeCategory = btn.dataset.category;
    renderFilters();
    renderApps();
  }));
}

function renderApps(){
  const q = searchInput.value.trim().toLowerCase();
  const filtered = apps.filter(app => {
    const matchesCategory = activeCategory === 'Toutes' || app.category === activeCategory;
    const haystack = [app.name, app.description, app.category, ...(app.tags||[])].join(' ').toLowerCase();
    return matchesCategory && haystack.includes(q);
  });
  grid.innerHTML = filtered.map((app, i) => cardHtml(app, apps.indexOf(app))).join('');
  emptyState.classList.toggle('hidden', filtered.length !== 0);
  grid.querySelectorAll('[data-details]').forEach(btn => btn.addEventListener('click', () => openDetails(Number(btn.dataset.details))));
}

function cardHtml(app, index){
  const icon = app.icon ? `<img src="${app.icon}" alt="">` : app.shortName;
  const safeDownload = app.downloadUrl && app.downloadUrl !== '#' ? app.downloadUrl : '#';
  return `
    <article class="app-card">
      <div class="app-top">
        <div class="app-icon">${icon}</div>
        <div>
          <h3>${app.name}</h3>
          <div class="meta">Version ${app.version} • ${app.updated}</div>
        </div>
      </div>
      <p class="desc">${app.description}</p>
      <div class="tags">${(app.tags||[]).map(t=>`<span class="tag">${t}</span>`).join('')}</div>
      <div class="app-actions">
        <a class="btn primary download" href="${safeDownload}" ${safeDownload==='#'?'onclick="alert(\'Ajoute d’abord le lien APK dans apps.js\'); return false;"':'download'}>Télécharger APK</a>
        <button class="btn secondary details" data-details="${index}">Détails</button>
      </div>
    </article>`;
}

function openDetails(index){
  const app = apps[index];
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
    <button class="close" aria-label="Fermer">×</button>
    <span class="eyebrow">${app.category}</span>
    <h3>${app.name}</h3>
    <p class="muted">Version ${app.version} • Mise à jour : ${app.updated}</p>
    <p>${app.description}</p>
    <h4>Nouveautés</h4>
    <ul>${(app.changes||[]).map(c=>`<li>${c}</li>`).join('')}</ul>
    <a class="btn primary" href="${app.downloadUrl || '#'}" ${(!app.downloadUrl || app.downloadUrl==='#')?'onclick="alert(\'Ajoute d’abord le lien APK dans apps.js\'); return false;"':''}>Télécharger APK</a>
  </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('.close').onclick = close;
  modal.addEventListener('click', e => { if(e.target === modal) close(); });
}

searchInput.addEventListener('input', renderApps);
renderFilters();
renderApps();
