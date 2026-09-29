// ============================================================================
// Section "EDT" — routes Express, montées depuis server.js. Toute l'app vit
// sous /edt (page servie à /edt/, API sous /edt/api/...), fichiers statiques
// (JS/CSS/manifest/service worker/icônes) servis depuis public/edt/.
// ============================================================================

const path = require('path');
const express = require('express');
const schedule = require('./schedule');
const push = require('./push');

const router = express.Router();
const EDT_PUBLIC_DIR = path.join(__dirname, '..', '..', 'public', 'edt');

// /edt (sans le slash final) -> /edt/, pour que les chemins relatifs de la
// page (manifest, scope du service worker...) se résolvent correctement.
router.get('/edt', (req, res) => res.redirect('/edt/'));

router.get('/edt/api/schedule', (req, res) => {
  res.json(schedule.getScheduleData());
});

router.get('/edt/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: push.VAPID_PUBLIC_KEY, configured: push.isConfigured() });
});

router.post('/edt/api/subscribe', (req, res) => {
  const body = req.body;
  const sub = body && body.subscription;
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || !sub.endpoint) {
    return res.status(400).json({ error: 'Abonnement invalide.' });
  }
  push.setSubscription(sub);
  res.json({ ok: true });
});

router.post('/edt/api/test-push', async (req, res) => {
  try {
    const result = await push.sendTestPush();
    if (!result.ok) return res.status(502).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Fichiers statiques (index.html, edt.js, edt.css, sw.js, manifest.json,
// schedule-core.js, icônes) — en dernier, pour laisser les routes API
// ci-dessus prendre la main sur /edt/api/*.
router.use('/edt', express.static(EDT_PUBLIC_DIR));

module.exports = router;
