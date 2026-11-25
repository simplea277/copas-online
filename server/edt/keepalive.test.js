// ============================================================================
// Tests du maintien en éveil (server/edt/keepalive.js) : classement des
// appels à /ping, adresse d'auto-ping, et un vrai aller-retour HTTP local
// (le serveur s'appelle lui-même sur /ping et le voit dans /ping/status).
// ============================================================================

const assert = require('assert');
const http = require('http');
const express = require('express');
const keepalive = require('./keepalive');

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    failures++;
    console.log(`❌ ${name}`);
    console.log('   ', e.message);
    process.exitCode = 1;
  }
}

(async () => {
  await test('classe la source des appels à /ping selon le User-Agent', () => {
    assert.strictEqual(keepalive._classifyPingSource('Mozilla/5.0 (compatible; cron-job.org; http://cron-job.org/abuse/)'), 'cron-job.org');
    assert.strictEqual(keepalive._classifyPingSource(keepalive.SELF_PING_USER_AGENT), 'auto');
    assert.strictEqual(keepalive._classifyPingSource('curl/8.0'), 'autre');
    assert.strictEqual(keepalive._classifyPingSource(undefined), 'autre');
  });

  await test('adresse d\'auto-ping : KEEPALIVE_URL prioritaire, puis RENDER_EXTERNAL_URL, slash final retiré', () => {
    assert.strictEqual(keepalive._resolveBaseUrl({}), '');
    assert.strictEqual(keepalive._resolveBaseUrl({ RENDER_EXTERNAL_URL: 'https://x.onrender.com/' }), 'https://x.onrender.com');
    assert.strictEqual(keepalive._resolveBaseUrl({ RENDER_EXTERNAL_URL: 'https://x.onrender.com', KEEPALIVE_URL: 'https://y.example' }), 'https://y.example');
  });

  await test('sans adresse publique (local), l\'auto-ping reste désactivé sans planter', () => {
    keepalive.start({});
    assert.strictEqual(keepalive.getStatus().selfPingEnabled, false);
  });

  await test('aller-retour réel : /ping répond "ok", l\'auto-ping et cron-job.org apparaissent dans /ping/status', async () => {
    const app = express();
    app.use(keepalive.router);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const base = 'http://127.0.0.1:' + server.address().port;
    try {
      const ping = await fetch(base + '/ping', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; cron-job.org)' } });
      assert.strictEqual(ping.status, 200);
      assert.strictEqual(await ping.text(), 'ok');

      const self = await keepalive._selfPing(base);
      assert.strictEqual(self.ok, true);
      assert.strictEqual(self.status, 200);

      const status = await (await fetch(base + '/ping/status')).json();
      assert.ok(status.lastCronJobPingAt, 'dernier appel cron-job.org enregistré');
      assert.strictEqual(status.recentPings[0].source, 'auto');
      assert.strictEqual(status.recentPings[1].source, 'cron-job.org');
      assert.strictEqual(status.lastSelfPing.ok, true);
    } finally {
      server.close();
    }
  });

  await test('auto-ping vers une adresse injoignable : échec enregistré, pas d\'exception', async () => {
    const result = await keepalive._selfPing('http://127.0.0.1:1');
    assert.strictEqual(result.ok, false);
    assert.ok(result.error);
  });

  if (failures === 0) console.log('\nTous les tests keepalive passent.');
})();
