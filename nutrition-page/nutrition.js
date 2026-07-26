// Section "Nutrition" — page indépendante du jeu de cartes, vanilla JS sans
// framework (même esprit que public/client.js) : un state + une fonction
// render() qui régénère #app à chaque changement. Voir CLAUDE.md.

const state = {
  products: [],
  loading: true,
  error: null,
  submitting: false,
  // Lignes vitamines/minéraux du formulaire en cours de saisie (pas encore
  // envoyées) : chaque ligne = { name, amount }.
  draftVitamins: [],
};

const NUMBER_FIELDS = [
  { key: 'calories_kcal', label: 'Calories (kcal)' },
  { key: 'protein_g', label: 'Protéines (g)' },
  { key: 'carbohydrates_g', label: 'Glucides (g)' },
  { key: 'sugars_g', label: 'dont sucres (g)' },
  { key: 'fat_g', label: 'Lipides (g)' },
  { key: 'saturated_fat_g', label: 'dont acides gras saturés (g)' },
  { key: 'fiber_g', label: 'Fibres (g)' },
  { key: 'salt_g', label: 'Sel (g)' },
];

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

  const body = { name, vitamins_minerals: state.draftVitamins };
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
    state.draftVitamins = [];
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

function addVitaminRow() {
  state.draftVitamins.push({ name: '', amount: '' });
  render();
}

function removeVitaminRow(index) {
  state.draftVitamins.splice(index, 1);
  render();
}

function updateVitaminRow(index, key, value) {
  // Pas de re-render ici : on écrit directement le state pendant la frappe
  // pour ne pas perdre le focus de l'input (même piège que le chat, voir
  // CLAUDE.md) — le state est de toute façon relu au submit.
  state.draftVitamins[index][key] = value;
}

function renderVitaminRows() {
  return state.draftVitamins
    .map(
      (row, i) => `
    <div class="vitamin-row" data-index="${i}">
      <input type="text" placeholder="Nom (ex: Vitamine C)" class="vitamin-name" value="${escapeHtml(row.name)}" />
      <input type="text" placeholder="Quantité (ex: 12 mg)" class="vitamin-amount" value="${escapeHtml(row.amount)}" />
      <button type="button" class="btn-remove-vitamin" data-index="${i}" aria-label="Retirer">✕</button>
    </div>`
    )
    .join('');
}

function renderForm() {
  return `
    <form id="product-form" class="product-form">
      <h2>Ajouter un produit</h2>
      <label class="field">
        <span>Nom du produit</span>
        <input type="text" name="name" required maxlength="200" placeholder="Ex: Yaourt nature Bio" />
      </label>
      <label class="field">
        <span>Portion de référence (optionnel)</span>
        <input type="text" name="serving_size" maxlength="100" placeholder="Ex: pour 100 g" />
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
      <div class="vitamins-section">
        <div class="vitamins-header">
          <span>Vitamines / minéraux (optionnel)</span>
          <button type="button" id="btn-add-vitamin">+ Ajouter</button>
        </div>
        <div id="vitamin-rows">${renderVitaminRows()}</div>
      </div>
      ${state.error ? `<p class="form-error">${escapeHtml(state.error)}</p>` : ''}
      <button type="submit" class="btn-submit" ${state.submitting ? 'disabled' : ''}>
        ${state.submitting ? 'Ajout…' : 'Ajouter au tableau'}
      </button>
    </form>`;
}

function renderProductRow(p) {
  const vitamins = Array.isArray(p.vitamins_minerals) ? p.vitamins_minerals : [];
  return `
    <tr>
      <td class="col-name">${escapeHtml(p.name)}${p.serving_size ? `<div class="serving-size">${escapeHtml(p.serving_size)}</div>` : ''}</td>
      <td>${formatNumber(p.calories_kcal)}</td>
      <td>${formatNumber(p.protein_g)}</td>
      <td>${formatNumber(p.carbohydrates_g)}<div class="sub">dont sucres ${formatNumber(p.sugars_g)}</div></td>
      <td>${formatNumber(p.fat_g)}<div class="sub">dont saturés ${formatNumber(p.saturated_fat_g)}</div></td>
      <td>${formatNumber(p.fiber_g)}</td>
      <td>${formatNumber(p.salt_g)}</td>
      <td>${vitamins.length ? vitamins.map((v) => `${escapeHtml(v.name)}: ${escapeHtml(v.amount)}`).join('<br/>') : '—'}</td>
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
            <th>Vitamines / minéraux</th>
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

  const addBtn = document.getElementById('btn-add-vitamin');
  if (addBtn) addBtn.addEventListener('click', addVitaminRow);

  document.querySelectorAll('.btn-remove-vitamin').forEach((btn) => {
    btn.addEventListener('click', () => removeVitaminRow(Number(btn.dataset.index)));
  });
  document.querySelectorAll('.vitamin-name').forEach((input, i) => {
    input.addEventListener('input', (e) => updateVitaminRow(i, 'name', e.target.value));
  });
  document.querySelectorAll('.vitamin-amount').forEach((input, i) => {
    input.addEventListener('input', (e) => updateVitaminRow(i, 'amount', e.target.value));
  });
  document.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.id));
  });
}

loadProducts();
