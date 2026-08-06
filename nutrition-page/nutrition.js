// Section "Nutrition" — page indépendante du jeu de cartes, vanilla JS sans
// framework (même esprit que public/client.js) : un state + une fonction
// render() qui régénère #app à chaque changement. Voir CLAUDE.md.

const THEME_STORAGE_KEY = 'nutrition:theme';

function getPreferredTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

const state = {
  products: [],
  loading: true,
  error: null,
  submitting: false,
  theme: getPreferredTheme(),
  // Ids des produits dont le nom complet est déplié (au lieu de tronqué à 2
  // lignes) suite à un clic sur "…".
  expandedNames: new Set(),
  // Produit en cours de modification (formulaire pré-rempli), null = mode ajout.
  editingProduct: null,
};

applyTheme(state.theme);

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_STORAGE_KEY, state.theme);
  applyTheme(state.theme);
  render();
}

const NUMBER_FIELDS = [
  { key: 'calories_kcal', label: 'Calories (kcal)' },
  { key: 'fat_g', label: 'Lipides (g)' },
  { key: 'saturated_fat_g', label: 'dont acides gras saturés (g)' },
  { key: 'carbohydrates_g', label: 'Glucides (g)' },
  { key: 'sugars_g', label: 'dont sucres (g)' },
  { key: 'fiber_g', label: 'Fibres (g)' },
  { key: 'protein_g', label: 'Protéines (g)' },
  { key: 'salt_g', label: 'Sel (g)' },
];

const DEFAULT_SERVING_SIZE = '100 g';

const app = document.getElementById('app');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatNumber(n) {
  return n === null || n === undefined ? '—' : String(n);
}

async function loadProducts() {
  state.loading = true;
  state.error = null;
  render();
  try {
    const res = await fetch('/api/nutrition/products');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    state.products = data.products || [];
  } catch (err) {
    state.error = err.message || 'Erreur de chargement.';
  } finally {
    state.loading = false;
    render();
  }
}

async function handleSubmit(evt) {
  evt.preventDefault();
  const form = evt.target;
  const formData = new FormData(form);
  const name = (formData.get('name') || '').toString().trim();
  if (!name) return;

  const body = { name };
  for (const field of NUMBER_FIELDS) {
    const raw = (formData.get(field.key) || '').toString().trim();
    body[field.key] = raw === '' ? null : Number(raw);
  }
  const servingSize = (formData.get('serving_size') || '').toString().trim();
  body.serving_size = servingSize || null;

  const editingId = state.editingProduct ? state.editingProduct.id : null;

  state.submitting = true;
  state.error = null;
  render();
  try {
    const res = await fetch(
      editingId ? `/api/nutrition/products/${encodeURIComponent(editingId)}` : '/api/nutrition/products',
      {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    state.editingProduct = null;
    await loadProducts();
  } catch (err) {
    state.error = err.message || (editingId ? 'Erreur lors de la modification.' : "Erreur lors de l'ajout.");
    state.submitting = false;
    render();
  }
}

function handleEdit(id) {
  const product = state.products.find((p) => p.id === id);
  if (!product) return;
  state.editingProduct = product;
  state.error = null;
  render();
  const form = document.getElementById('product-form');
  if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function handleCancelEdit() {
  state.editingProduct = null;
  state.error = null;
  render();
}

function toggleNameExpanded(id) {
  if (state.expandedNames.has(id)) state.expandedNames.delete(id);
  else state.expandedNames.add(id);
  render();
}

async function handleDelete(id) {
  if (!confirm('Supprimer ce produit du tableau partagé ?')) return;
  try {
    const res = await fetch(`/api/nutrition/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Erreur ${res.status}`);
    }
    if (state.editingProduct && state.editingProduct.id === id) state.editingProduct = null;
    await loadProducts();
  } catch (err) {
    state.error = err.message || 'Erreur lors de la suppression.';
    render();
  }
}

function renderForm() {
  const editing = state.editingProduct;
  const nameValue = editing ? editing.name : '';
  const servingValue = editing ? (editing.serving_size || '') : DEFAULT_SERVING_SIZE;
  return `
    <form id="product-form" class="product-form">
      <h2>${editing ? 'Modifier le produit' : 'Ajouter un produit'}</h2>
      <label class="field">
        <span>Nom du produit</span>
        <input type="text" name="name" required maxlength="200" placeholder="Ex: Yaourt nature Bio" value="${escapeHtml(nameValue)}" />
      </label>
      <div class="number-grid">
        ${NUMBER_FIELDS.map(
          (f) => `
          <label class="field">
            <span>${escapeHtml(f.label)}</span>
            <input type="number" step="any" name="${f.key}" value="${editing && editing[f.key] !== null && editing[f.key] !== undefined ? escapeHtml(editing[f.key]) : ''}" />
          </label>`
        ).join('')}
      </div>
      <label class="field">
        <span>Portion de référence (optionnel)</span>
        <input type="text" name="serving_size" maxlength="100" value="${escapeHtml(servingValue)}" placeholder="Ex: pour 100 g" />
      </label>
      ${state.error ? `<p class="form-error">${escapeHtml(state.error)}</p>` : ''}
      <div class="form-actions">
        <button type="submit" class="btn-submit" ${state.submitting ? 'disabled' : ''}>
          ${state.submitting ? 'Enregistrement…' : (editing ? 'Enregistrer les modifications' : 'Ajouter au tableau')}
        </button>
        ${editing ? '<button type="button" class="btn-cancel-edit" id="btn-cancel-edit">Annuler</button>' : ''}
      </div>
    </form>`;
}

function renderProductRow(p) {
  const expanded = state.expandedNames.has(p.id);
  return `
    <tr>
      <td class="col-name"><div class="product-name${expanded ? ' expanded' : ''}" data-id="${escapeHtml(p.id)}" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>${p.serving_size ? `<div class="serving-size">${escapeHtml(p.serving_size)}</div>` : ''}</td>
      <td>${formatNumber(p.calories_kcal)}</td>
      <td>${formatNumber(p.protein_g)}</td>
      <td>${formatNumber(p.carbohydrates_g)}<div class="sub">dont sucres ${formatNumber(p.sugars_g)}</div></td>
      <td>${formatNumber(p.fat_g)}<div class="sub">dont saturés ${formatNumber(p.saturated_fat_g)}</div></td>
      <td>${formatNumber(p.fiber_g)}</td>
      <td>${formatNumber(p.salt_g)}</td>
      <td class="col-actions">
        <button type="button" class="btn-edit" data-id="${escapeHtml(p.id)}">Modifier</button>
        <button type="button" class="btn-delete" data-id="${escapeHtml(p.id)}">Supprimer</button>
      </td>
    </tr>`;
}

function renderList() {
  if (state.loading) return '<p>Chargement…</p>';
  if (!state.products.length) return '<p class="empty">Aucun produit pour l\'instant.</p>';
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="col-name">Produit</th>
            <th>Calories</th>
            <th>Protéines (g)</th>
            <th>Glucides (g)</th>
            <th>Lipides (g)</th>
            <th>Fibres (g)</th>
            <th>Sel (g)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${state.products.map(renderProductRow).join('')}</tbody>
      </table>
    </div>`;
}

function render() {
  app.innerHTML = `
    <div class="nutrition-page">
      <div class="nutrition-header">
        <h1>Nutrition</h1>
        <button type="button" class="btn-theme-toggle" id="btn-theme-toggle">
          ${state.theme === 'dark' ? '☀️ Mode clair' : '🌙 Mode sombre'}
        </button>
      </div>
      <div class="nutrition-layout">
        <div class="nutrition-col-form">${renderForm()}</div>
        <div class="nutrition-col-list">
          <h2>Produits enregistrés</h2>
          ${renderList()}
        </div>
      </div>
    </div>`;
  attachHandlers();
}

function handleFormFieldKeydown(evt) {
  if (evt.key !== 'Enter' || evt.target.tagName !== 'INPUT') return;
  evt.preventDefault();
  const inputs = Array.from(evt.currentTarget.querySelectorAll('input'));
  const index = inputs.indexOf(evt.target);
  const next = inputs[index + 1];
  if (next) next.focus();
}

function attachHandlers() {
  const form = document.getElementById('product-form');
  if (form) {
    form.addEventListener('submit', handleSubmit);
    form.addEventListener('keydown', handleFormFieldKeydown);
  }

  const themeBtn = document.getElementById('btn-theme-toggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  const cancelEditBtn = document.getElementById('btn-cancel-edit');
  if (cancelEditBtn) cancelEditBtn.addEventListener('click', handleCancelEdit);

  document.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.id));
  });

  document.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => handleEdit(btn.dataset.id));
  });

  document.querySelectorAll('.product-name').forEach((el) => {
    el.addEventListener('click', () => toggleNameExpanded(el.dataset.id));
  });
}

loadProducts();
