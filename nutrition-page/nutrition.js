// Section "Nutrition" — page indépendante du jeu de cartes, vanilla JS sans
// framework (même esprit que public/client.js) : un state + une fonction
// render() qui régénère #app à chaque changement. Voir CLAUDE.md.

const state = {
  products: [],
  loading: true,
  error: null,
  submitting: false,
};

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

  state.submitting = true;
  state.error = null;
  render();
  try {
    const res = await fetch('/api/nutrition/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    await loadProducts();
  } catch (err) {
    state.error = err.message || "Erreur lors de l'ajout.";
    state.submitting = false;
    render();
  }
}

async function handleDelete(id) {
  if (!confirm('Supprimer ce produit du tableau partagé ?')) return;
  try {
    const res = await fetch(`/api/nutrition/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Erreur ${res.status}`);
    }
    await loadProducts();
  } catch (err) {
    state.error = err.message || 'Erreur lors de la suppression.';
    render();
  }
}

function renderForm() {
  return `
    <form id="product-form" class="product-form">
      <h2>Ajouter un produit</h2>
      <label class="field">
        <span>Nom du produit</span>
        <input type="text" name="name" required maxlength="200" placeholder="Ex: Yaourt nature Bio" />
      </label>
      <div class="number-grid">
        ${NUMBER_FIELDS.map(
          (f) => `
          <label class="field">
            <span>${escapeHtml(f.label)}</span>
            <input type="number" step="any" name="${f.key}" />
          </label>`
        ).join('')}
      </div>
      <label class="field">
        <span>Portion de référence (optionnel)</span>
        <input type="text" name="serving_size" maxlength="100" value="${escapeHtml(DEFAULT_SERVING_SIZE)}" placeholder="Ex: pour 100 g" />
      </label>
      ${state.error ? `<p class="form-error">${escapeHtml(state.error)}</p>` : ''}
      <button type="submit" class="btn-submit" ${state.submitting ? 'disabled' : ''}>
        ${state.submitting ? 'Ajout…' : 'Ajouter au tableau'}
      </button>
    </form>`;
}

function renderProductRow(p) {
  return `
    <tr>
      <td class="col-name">${escapeHtml(p.name)}${p.serving_size ? `<div class="serving-size">${escapeHtml(p.serving_size)}</div>` : ''}</td>
      <td>${formatNumber(p.calories_kcal)}</td>
      <td>${formatNumber(p.protein_g)}</td>
      <td>${formatNumber(p.carbohydrates_g)}<div class="sub">dont sucres ${formatNumber(p.sugars_g)}</div></td>
      <td>${formatNumber(p.fat_g)}<div class="sub">dont saturés ${formatNumber(p.saturated_fat_g)}</div></td>
      <td>${formatNumber(p.fiber_g)}</td>
      <td>${formatNumber(p.salt_g)}</td>
      <td><button type="button" class="btn-delete" data-id="${escapeHtml(p.id)}">Supprimer</button></td>
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
            <th>Produit</th>
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
      <h1>Nutrition</h1>
      ${renderForm()}
      <h2>Produits enregistrés</h2>
      ${renderList()}
    </div>`;
  attachHandlers();
}

function attachHandlers() {
  const form = document.getElementById('product-form');
  if (form) form.addEventListener('submit', handleSubmit);

  document.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.id));
  });
}

loadProducts();
