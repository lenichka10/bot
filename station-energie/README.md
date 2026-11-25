# Station Energie (myclimate · Skills for Future)

Workshop station for apprentices: groups work on their phones, the Leitung sees all answers live.

- **Setup:** see [ANLEITUNG.md](ANLEITUNG.md) (Supabase + Netlify, for non-developers)
- Group link: `https://<your-site>/` · Leitung: `https://<your-site>/#leitung` (PIN 1234)

## Morning checklist (15 min before the start)

1. Open the Leitung link on your laptop → PIN → you see the dashboard (no "Keine Verbindung"). If Supabase was paused: Supabase → Restore project.
2. **Neue Runde starten** → confirm. (Deletes the test answers.)
3. Choose the **profession** of today's class.
4. Test with your phone: choose a group → it appears on the dashboard → on the laptop, **Gruppe freigeben** for that group.
5. Wi-Fi: open the group link once on the venue Wi-Fi (some school networks block sites).
6. Show the group link as a QR code or a short link (e.g. on the flipchart or on the first slide).
7. Projector: connect the laptop. During the debriefing use **Präsentieren** (hides the buttons, bigger text).
8. During the workshop: if a phone runs out of battery → **Gruppe freigeben** → the group chooses its number again on another device (it starts again from step 1).

## How it works

| Part | Where |
|---|---|
| Texts, search picture, cards, measures, professions | `content.js` (unchanged from the reference version) |
| Group view, Leitung view, saving, offline retry | `app.js` |
| Look (myclimate colours, Arial) | `style.css` |
| Tables, security rules, server functions | `supabase/setup.sql` |

Security: browsers can only **read** rounds and answers. All writes go through server functions:
`claim_group` (atomic, unique key per round + group), `save_state` (only with the device's secret token, which is stored in a table no browser can read), and `leitung_*` (PIN checked on the server, stored as a bcrypt hash).

## Tests (developers)

```
cd tests && npm install
./db_test.sh     # SQL rules, PIN, release, new round, race of 6 parallel claims
./run-e2e.sh     # 1 Leitung + 7 phone browsers: claiming race, full run, live dashboard,
                 # offline + retry, release, new round, 375 px layout, 44 px buttons
```
Needs a local PostgreSQL 16 and Playwright. `tests/fake-supabase.js` imitates the Supabase REST API on the real SQL. Realtime is not imitated: the tests use the app's 15-second backup check (1 s in tests).

## Building the other stations (Materialien, Prozesse, Produktdesign)

The app is built so that only the content and the step views change from station to station:

1. **Copy the folder**, e.g. `station-materialien/`.
2. **Database:** either a new free Supabase project per station (simplest: just run `setup.sql` again there), or one shared project with a station column. For the shared option, ask a developer: add `station text` to `rounds` and `groups` and a parameter `p_station` to every function.
3. **`content.js`:** replace the content with the content of the new station (from its reference artifact: "Station Materialien digital", "Station Prozesse digital", "Station Produktdesign digital").
4. **`app.js`:** the parts that stay the same are claiming, saving, offline, rounds, PIN, release, Präsentieren. The parts that change are the view functions `viewSearch / viewFacts / viewSort / viewExpert / viewNote`, `blank()`, `payload()` and the panels in `renderLeitung()`. Rule: every answer in `G.S`, call `save()` after each change, and show it on the dashboard from `L.docs`.
5. **Header text:** `header()` in `app.js` ("Station 1 · Energie") and `<title>` in `index.html`.
6. Deploy as a new Netlify site, run the tests, then do the Step 4 test from ANLEITUNG.md.

Tip: give Claude the reference artifact of the station and this folder, and ask for "the same app as station-energie for Station X".
