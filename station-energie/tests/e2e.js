// End-to-end test: 1 Leitung + 6 group devices (+ extras) in parallel.
// Run with ./run-e2e.sh (starts Postgres and the fake Supabase first).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:8787';
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const CONFIG = `window.STATION_CONFIG = { url: '${BASE}', anonKey: 'test-anon-key', pollMs: 1000 };`;
const MEASURE_FIELD = { m1: 'effizienter', m2: 'sauberer', m3: 'vermeiden', m4: 'weiter', m5: 'effizienter', m6: 'sauberer', m7: 'vermeiden', m8: 'effizienter' };

let failures = 0;
function check(cond, msg) { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitText(page, text, ms = 8000) {
  try { await page.getByText(text, { exact: false }).first().waitFor({ timeout: ms }); return true; } catch (e) { return false; }
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function device(opts = {}) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true }, opts));
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: CONFIG }));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    return { ctx, page };
  }

  // ---------- Leitung ----------
  console.log('Leitung: PIN');
  const lead = await device({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
  await lead.page.goto(BASE + '/#leitung');
  await lead.page.fill('#pin', '0000'); await lead.page.click('button[type=submit]');
  check(await waitText(lead.page, 'Falscher PIN'), 'wrong PIN is refused');
  check(!(await lead.page.locator('text=Neue Runde starten').count()), 'nothing else visible without PIN');
  await lead.page.fill('#pin', '1234'); await lead.page.click('button[type=submit]');
  check(await waitText(lead.page, 'Beruf dieser Runde'), 'correct PIN opens Leitung');
  await lead.page.click('button[data-b=polymech]');
  check(await waitText(lead.page, 'Beruf gespeichert: Polymechaniker/innen'), 'profession saved');
  await lead.page.reload();
  check(await waitText(lead.page, 'Beruf dieser Runde'), 'PIN kept for the browser session');
  // /leitung path works too
  const lead2 = await lead.ctx.newPage();
  await lead2.goto(BASE + '/leitung');
  check(await waitText(lead2, 'PIN eingeben'), '/leitung path works (new tab asks for the PIN again)');
  await lead2.close();

  // ---------- 6 devices ----------
  console.log('Groups: claiming');
  const devs = [];
  for (let i = 0; i < 6; i++) devs.push(await device());
  await Promise.all(devs.map(d => d.page.goto(BASE + '/')));
  await Promise.all(devs.map(d => d.page.locator('button[data-act=group][data-g="1"]:not([disabled])').waitFor()));
  check(!(await devs[0].page.locator('a[href*="leitung"], [data-act="switch"]').count()), 'no Leitung link and no switch-group button');
  await devs[0].page.screenshot({ path: path.join(SHOTS, '01-start.png'), fullPage: true });

  // race: device 0 and 1 tap group 1 at the same moment
  await Promise.all([devs[0].page.click('button[data-g="1"]'), devs[1].page.click('button[data-g="1"]')]);
  await sleep(1500);
  const won = await Promise.all([0, 1].map(i => devs[i].page.locator('.chip', { hasText: 'Gruppe 1' }).count()));
  check(won[0] + won[1] === 1, 'race: exactly one device gets Gruppe 1');
  const loser = won[0] ? devs[1] : devs[0];
  const winner = won[0] ? devs[0] : devs[1];
  check(await waitText(loser.page, 'Diese Gruppe ist schon vergeben. Wählt eine andere.'), 'loser sees "schon vergeben"');
  check(await loser.page.locator('button[data-g="1"][aria-disabled=true]', { hasText: 'vergeben' }).count() === 1, 'Gruppe 1 shown greyed out "vergeben"');
  await loser.page.click('button[data-g="2"]');
  const order = [winner, loser, devs[2], devs[3], devs[4], devs[5]]; // order[i] = Gruppe i+1
  for (let i = 2; i < 6; i++) await order[i].page.click(`button[data-g="${i + 1}"]`);
  for (let i = 0; i < 6; i++) check(await waitText(order[i].page, 'Gruppe ' + (i + 1)), `device has Gruppe ${i + 1}`);

  const late = await device();
  await late.page.goto(BASE + '/');
  await sleep(1500);
  check(await late.page.locator('button[aria-disabled=true]', { hasText: 'vergeben' }).count() === 6, 'a 7th device sees all 6 groups "vergeben"');

  // ---------- Gruppe 1 plays the whole station ----------
  console.log('Gruppe 1: full run');
  const p = order[0].page;
  for (const s of ['kompressor', 'leck', 'licht', 'tor']) await p.locator(`.hit[data-spot=${s}]`).first().click({ force: true });
  check(await waitText(p, 'Gefunden: 4'), 'search picture counts 4 found');
  await p.screenshot({ path: path.join(SHOTS, '02-search.png'), fullPage: true });
  await p.click('[data-act=reveal]');
  check(await waitText(p, '4 von 8 gefunden'), 'reveal shows 4 von 8');
  await p.click('[data-act=next]');
  await p.click('[data-act=pick][data-f=E1][data-o=C]'); await p.click('[data-act=lock][data-f=E1]');
  await p.click('[data-act=pick][data-f=E2][data-o=A]'); await p.click('[data-act=lock][data-f=E2]');
  await p.fill('#e3-leck', '15'); await p.fill('#e3-hoer', '50'); await p.click('[data-act=lock][data-f=E3]');
  check(await waitText(p, 'Eure Schätzung: 15 % Verlust'), 'E3 locked with numbers');
  await p.click('[data-act=extras]');
  await p.click('[data-act=pick][data-f=E4][data-o=B]'); await p.click('[data-act=lock][data-f=E4]');
  await p.screenshot({ path: path.join(SHOTS, '03-facts.png'), fullPage: true });
  await p.click('[data-act=next]');
  for (const [m, f] of Object.entries(MEASURE_FIELD)) {
    await p.click(`[data-act=card][data-m=${m}]`);
    await p.click(`[data-act=field][data-field=${f}]`);
  }
  await p.click('[data-act=check]');
  check(await waitText(p, '8 von 8 im gleichen Feld'), 'sorting 8 von 8');
  await p.screenshot({ path: path.join(SHOTS, '04-sort.png'), fullPage: true });
  await p.click('[data-act=next]');
  check(await waitText(p, 'Polymechaniker/innen'), 'expert card follows the Leitung profession');
  await p.fill('#experte', 'Blaspistole durch Besen ersetzen');
  await p.click('[data-act=send][data-k=experteGesendet]');
  check(await waitText(p, 'Gesendet ✓'), 'expert answer "Gesendet ✓"');
  await p.screenshot({ path: path.join(SHOTS, '05-expert.png'), fullPage: true });
  await p.click('[data-act=next]');
  await p.click('[data-act=surp][data-f=E2]');
  await p.fill('#notiz', 'Lecks im Lehrbetrieb suchen, nächste Woche');
  await p.click('[data-act=send][data-k=notizGesendet]');
  check(await waitText(p, 'Wow-Karte'), 'Wow-Karte after note');
  check(await waitText(p, 'Wartet auf das Zeichen der Leitung'), 'end panel text');
  await p.screenshot({ path: path.join(SHOTS, '06-end.png'), fullPage: true });

  // reload keeps the place
  await p.reload();
  check(await waitText(p, 'Geschafft!'), 'reload: group comes back to where it was');

  // second tab in the same browser must NOT take over Gruppe 1
  const tab2 = await order[0].ctx.newPage();
  await tab2.goto(BASE + '/');
  check(await waitText(tab2, 'Welche Gruppe seid ihr?'), 'second tab in same browser shows start screen');
  await tab2.close();

  // Gruppe 2 does something, Gruppe 3 only search
  await order[1].page.locator('.hit[data-spot=pistole]').first().click({ force: true });
  await order[1].page.click('[data-act=reveal]'); await order[1].page.click('[data-act=next]');
  await order[1].page.click('[data-act=pick][data-f=E1][data-o=A]'); await order[1].page.click('[data-act=lock][data-f=E1]');

  // ---------- Leitung dashboard (live via poll) ----------
  console.log('Leitung: dashboard');
  const L = lead.page;
  check(await waitText(L, 'Fertig ✓'), 'Leitung sees Gruppe 1 fertig');
  check(await waitText(L, 'Blaspistole durch Besen ersetzen'), 'Leitung sees expert answer');
  check(await waitText(L, 'Lecks im Lehrbetrieb suchen'), 'Leitung sees note');
  check(await waitText(L, 'E2 · 1× · G1'), 'surprise count');
  check(await waitText(L, '8 / 8'), 'sorting score in table');
  check(await waitText(L, 'Schritt 2 · Schätzen'), 'Gruppe 2 step shown');
  check(await L.locator('td', { hasText: '15 %' }).count() >= 1, 'E3 numbers per group');
  await L.screenshot({ path: path.join(SHOTS, '07-leitung.png'), fullPage: true });
  await L.click('[data-act=present]');
  check(await L.locator('.ctrl').first().isHidden(), 'Präsentieren hides controls');
  await L.screenshot({ path: path.join(SHOTS, '08-praesentieren.png'), fullPage: true });
  await L.click('[data-act=present]');

  // ---------- offline ----------
  console.log('Offline');
  const o = order[3];
  await o.ctx.setOffline(true);
  await o.page.locator('.hit[data-spot=cnc]').first().click({ force: true });
  await o.page.click('[data-act=reveal]');
  check(await o.page.locator('#net').isVisible(), 'offline note shown');
  await o.page.screenshot({ path: path.join(SHOTS, '09-offline.png') });
  await o.page.click('[data-act=next]');
  check(await waitText(o.page, 'Schritt 2 · Schätzen'), 'keeps working offline');
  await o.ctx.setOffline(false);
  await sleep(4000);
  check(await o.page.locator('#net').isHidden(), 'offline note disappears when back online');
  check(await L.locator('.gstat', { hasText: 'Gruppe 4' }).filter({ hasText: 'Schritt 2' }).count() === 1, 'Leitung gets the offline answers later');

  // ---------- release ----------
  console.log('Release');
  await L.click('[data-act=release][data-g="5"]');
  await L.click('[data-act=rel-yes][data-g="5"]');
  check(await waitText(L, 'Gruppe 5 ist wieder frei'), 'Leitung released Gruppe 5');
  check(await waitText(order[4].page, 'Die Leitung hat eure Gruppe freigegeben'), 'device of Gruppe 5 back at start');
  await late.page.waitForSelector('button[data-act=group][data-g="5"]:not([disabled])', { timeout: 8000 });
  await late.page.click('button[data-g="5"]');
  check(await waitText(late.page, 'Gruppe 5'), 'another device can take Gruppe 5');

  // ---------- new round ----------
  console.log('New round');
  await L.click('[data-act=reset]');
  check(await waitText(L, 'Alle Antworten löschen? Das kann man nicht rückgängig machen.'), 'confirm step shown');
  await L.click('[data-act=reset-yes]');
  check(await waitText(L, 'Neue Runde gestartet'), 'new round started');
  check(await waitText(L, 'Noch keine Gruppe'), 'dashboard empty');
  check(await waitText(L, 'Die Gruppen sehen die Expertenkarte für Polymechaniker/innen'), 'profession kept');
  for (let i = 0; i < 6; i++) if (i !== 4) check(await waitText(order[i].page, 'neue Runde gestartet'), `Gruppe ${i + 1} device back at start`);
  check(await waitText(late.page, 'neue Runde gestartet'), 'device of new Gruppe 5 back at start');
  await sleep(1500);
  check(await order[0].page.locator('button[aria-disabled=true]').count() === 0, 'all groups free again');

  // layout: no horizontal page scroll on a small phone
  const sw = await order[0].page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(sw <= 0, 'no horizontal page scroll at 375 px');
  const small = await order[0].page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 44).length);
  check(small === 0, 'all buttons at least 44 px high');

  check(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL E2E CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
