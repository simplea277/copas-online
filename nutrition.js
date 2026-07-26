// ============================================================================
// Section "Nutrition" — complètement indépendante du jeu de cartes Copas.
// Accessible uniquement via /nutrition (aucun lien visible ailleurs sur le
// site). Pas de compte/connexion : tout visiteur connaissant l'URL voit et
// modifie le même tableau partagé. Voir CLAUDE.md pour le contexte complet.
//
// Saisie manuelle uniquement (pas d'extraction automatique par photo) : la
// version initiale prévoyait d'envoyer une photo de l'étiquette à l'API
// Claude pour extraire les valeurs automatiquement, mais l'API Claude
// nécessite un compte payant à l'usage (minimum 5$ de crédit) — abandonné à
// la demande de l'utilisateur au profit d'un formulaire 100% gratuit.
// ============================================================================

const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const MAX_NAME_LENGTH = 200;
const MAX_SERVING_SIZE_LENGTH = 100;
const MAX_VITAMINS_MINERALS = 20;
const MAX_NUTRIENT_NAME_LENGTH = 60;
const MAX_NUTRIENT_AMOUNT_LENGTH = 40;

let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
} else {
  console.warn(
    '[nutrition] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents de .env — ' +
    'la section /nutrition répondra 503 tant que ces variables ne sont pas définies.'
  );
}

function requireSupabase(req, res, next) {
  if (!supabase) {
    return res.status(503).json({ error: 'Base de données nutrition non configurée (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY manquants).' });
  }
  next();
}

// Un nombre saisi vide/invalide devient null (colonne numeric nullable),
// jamais NaN ni une chaîne, pour rester cohérent avec le schéma SQL.
function parseOptionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sanitizeVitaminsMinerals(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object')
    .slice(0, MAX_VITAMINS_MINERALS)
    .map((entry) => ({
      name: String(entry.name || '').trim().slice(0, MAX_NUTRIENT_NAME_LENGTH),
      amount: String(entry.amount || '').trim().slice(0, MAX_NUTRIENT_AMOUNT_LENGTH),
    }))
    .filter((entry) => entry.name && entry.amount);
}

function withErrorHandling(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error('[nutrition] erreur inattendue:', err);
      res.status(500).json({ error: 'Erreur interne du serveur. Réessaie.' });
    }
  };
}

const router = express.Router();

router.get('/api/nutrition/products', requireSupabase, withErrorHandling(async (req, res) => {
  const { data, error } = await supabase
    .from('nutrition_products')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ products: data });
}));

router.post('/api/nutrition/products', requireSupabase, withErrorHandling(async (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LENGTH) : '';
  if (!name) {
    return res.status(400).json({ error: 'Nom du produit requis.' });
  }

  const product = {
    name,
    calories_kcal: parseOptionalNumber(body.calories_kcal),
    protein_g: parseOptionalNumber(body.protein_g),
    carbohydrates_g: parseOptionalNumber(body.carbohydrates_g),
    sugars_g: parseOptionalNumber(body.sugars_g),
    fat_g: parseOptionalNumber(body.fat_g),
    saturated_fat_g: parseOptionalNumber(body.saturated_fat_g),
    fiber_g: parseOptionalNumber(body.fiber_g),
    salt_g: parseOptionalNumber(body.salt_g),
    serving_size: typeof body.serving_size === 'string'
      ? body.serving_size.trim().slice(0, MAX_SERVING_SIZE_LENGTH) || null
      : null,
    vitamins_minerals: sanitizeVitaminsMinerals(body.vitamins_minerals),
  };

  const { data, error } = await supabase
    .from('nutrition_products')
    .insert(product)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ product: data });
}));

router.delete('/api/nutrition/products/:id', requireSupabase, withErrorHandling(async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('nutrition_products').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).end();
}));

module.exports = router;
