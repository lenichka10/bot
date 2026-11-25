# Station Energie – setup guide

This folder is a complete web app. Groups use it on their phones, and the workshop leader (Leitung) watches all answers live.
You need two free accounts: **Supabase** (the database) and **Netlify** (the website). It takes about 30 minutes, only once.

```
station-energie/
├── index.html, style.css, app.js, content.js   ← the app
├── config.js                                   ← you enter 2 values here
├── vendor/                                     ← Supabase library (do not change)
├── supabase/setup.sql                          ← you paste this into Supabase
├── _redirects, vercel.json                     ← makes /leitung work
└── tests/                                      ← for developers only (not uploaded)
```

---

## Step 1 – Create the database (Supabase)

1. Go to **supabase.com** → *Start your project* → sign up (e.g. with GitHub or email).
2. Click **New project**.
   - Name: `station-energie`
   - Database password: click *Generate*. You will not need it again for this app.
   - Region: **Central EU (Zurich)** if offered, otherwise *Frankfurt*.
   - Click **Create new project** and wait 1–2 minutes.
3. In the left menu, open **SQL Editor** → **New query**.
4. Open the file `supabase/setup.sql` on your computer with a text editor (e.g. Notepad / TextEdit), select everything, copy it and paste it into the SQL Editor.
   - *Optional:* to use a PIN other than 1234, change `'1234'` near the end of the file (section "Start data") before you paste it.
5. Click **Run**. At the bottom you should see *Success. No rows returned*.
   (If Supabase asks "This query has destructive operations, run anyway?", click yes. The file deletes and rebuilds its own tables.)
6. Check that live updates are on: left menu **Database** → **Publications** → `supabase_realtime`. The tables `rounds` and `groups` should be switched on. (setup.sql does this for you. This is only a check.)

## Step 2 – Connect the app to the database

1. In Supabase, open **Project Settings** (gear icon) → **API** (in newer versions: **Data API** and **API Keys**).
2. Copy two values:
   - **Project URL**, e.g. `https://abcdxyz.supabase.co`
   - **anon public** key (a long text starting with `eyJ…`, or in newer projects the *publishable* key starting with `sb_publishable_…`).
     ⚠️ Do **not** use the *service_role* / *secret* key.
3. Open `config.js` in a text editor and replace the two placeholders:
   ```js
   window.STATION_CONFIG = {
     url: 'https://abcdxyz.supabase.co',
     anonKey: 'eyJhbGciOi…'
   };
   ```
4. Save the file.

The anon key may be public. It only allows what the database rules in setup.sql allow.

## Step 3 – Put the website online (Netlify, drag and drop)

1. Go to **app.netlify.com** → sign up.
2. Choose **Add new project → Deploy manually** (or go to **app.netlify.com/drop**).
3. Drag the **whole `station-energie` folder** onto the upload area. (The `tests` folder can be in it or not. It does no harm.)
4. After a few seconds you get an address like `https://lucky-otter-123.netlify.app`.
5. *Optional:* **Site configuration → Change site name** → e.g. `station-energie-myclimate`.
   Your address is then `https://station-energie-myclimate.netlify.app`.

**Your links**
- Groups: `https://<your-name>.netlify.app`
- Leitung: `https://<your-name>.netlify.app/#leitung` (or `…/leitung`)

To change something later: edit the files and drag the folder onto **Deploys → "Drag and drop"** again in the same Netlify project. The address stays the same.

*Alternative Vercel:* vercel.com → *Add New → Project* → import the GitHub repository and set **Root Directory** to `station-energie`, Framework *Other*, no build command. `vercel.json` makes `/leitung` work there.

## Step 4 – Test before the first workshop (15 minutes)

1. Open the Leitung link on your laptop → PIN `1234` → choose a profession.
2. Open the group link on 2–3 phones (or in several private browser windows).
3. Each phone chooses a different group. Try to choose the same group on two phones: the second one must show "Diese Gruppe ist schon vergeben".
4. Play a few steps on one phone. The Leitung view must update after 1–2 seconds without reloading.
5. Click **Gruppe freigeben** on one group: that phone goes back to the start screen.
6. Click **Neue Runde starten** → confirm: all phones go back to the start screen.

---

## Notes

- **Free tier pause:** Supabase pauses free projects after about 1 week without use. If the app shows "Keine Verbindung", log in to Supabase and click **Restore project** (takes ~2 minutes). Open the app the day before each workshop to be safe.
- **No live updates?** The app also checks every 15 seconds by itself, so the workshop still works, only a bit slower. Check Step 1.6.
- **PIN:** a convenience lock, not real security. There is no personal data in the app: only group numbers and answers.
- **Data:** "Neue Runde starten" deletes all answers of the old round for good.
- **Same browser, several tabs:** each tab is its own "device". A reloaded tab keeps its group. A new tab starts at the group selection.
