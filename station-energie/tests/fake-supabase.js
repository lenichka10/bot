// Minimal stand-in for Supabase's REST API (PostgREST) on top of a local
// Postgres, for tests only. Every query runs as role "anon", like the browser.
// Also serves the app's static files. Realtime is not imitated: the app's
// polling fallback carries the updates in tests.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const pool = new Pool({ host: '/tmp', port: 5433, user: 'postgres', database: 'postgres' });
const TABLES = { rounds: ['id', 'profession', 'active', 'created_at'], groups: ['round_id', 'group_no', 'state', 'updated_at'] };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

async function asAnon(sql, params) {
  const c = await pool.connect();
  try {
    await c.query('begin'); await c.query('set local role anon');
    const r = await c.query(sql, params);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return send(res, 204);
  try {
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = url.pathname.split('/').pop();
      if (!/^[a-z_]+$/.test(fn)) return send(res, 404, { message: 'no fn' });
      let raw = ''; for await (const ch of req) raw += ch;
      const args = raw ? JSON.parse(raw) : {};
      const keys = Object.keys(args).filter(k => /^p_[a-z]+$/.test(k));
      const vals = keys.map(k => (args[k] !== null && typeof args[k] === 'object') ? JSON.stringify(args[k]) : args[k]);
      const t = await pool.query(`select t.typname from pg_proc p join pg_type t on t.oid = p.prorettype where p.proname = $1`, [fn]);
      const call = `public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
      if (t.rows[0] && t.rows[0].typname === 'void') { await asAnon(`select ${call}`, vals); return send(res, 204); }
      const r = await asAnon(`select to_jsonb(${call}) as r`, vals);
      return send(res, 200, r.rows[0].r);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').pop();
      const cols = TABLES[table];
      if (!cols || req.method !== 'GET') return send(res, 404, { message: 'no table' });
      const sel = (url.searchParams.get('select') || '*').split(',').map(s => s.trim()).filter(c => cols.includes(c));
      const where = [], params = [];
      let order = '';
      for (const [k, v] of url.searchParams) {
        if (k === 'select') continue;
        if (k === 'order') { const [c, d] = v.split('.'); if (cols.includes(c)) order = ` order by ${c} ${d === 'desc' ? 'desc' : 'asc'}`; continue; }
        if (cols.includes(k) && v.startsWith('eq.')) { params.push(v.slice(3)); where.push(`${k}::text = $${params.length}`); }
      }
      const r = await asAnon(`select ${sel.length ? sel.join(', ') : '*'} from public.${table}${where.length ? ' where ' + where.join(' and ') : ''}${order}`, params);
      return send(res, 200, r.rows);
    }
    if (url.pathname.startsWith('/realtime/')) return send(res, 404, {});
    // static files
    let p = url.pathname === '/' || url.pathname === '/leitung' ? '/index.html' : url.pathname;
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT) || file.includes('node_modules') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, {});
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, e.code === '28000' ? 403 : 400, { code: e.code, message: e.message, details: null, hint: null });
  }
});
server.listen(PORT, () => console.log('fake supabase on http://localhost:' + PORT));
