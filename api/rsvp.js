// api/rsvp.js
// Speichert RSVP-Einträge in content/rsvp.json via GitHub API

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // --- Healthcheck: muss VOR der Method-Checks kommen ---
  if (req.method === 'GET' && (req.query?.health || req.query?.health === '1')) {
    return res.status(200).json({ ok: true, message: 'rsvp alive' });
  }

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // Body parsen
    const body = req.body ? req.body : await parseNodeRequestBody(req);
    const {
      eventId,       // z.B. "2025-12-05_weihnachtsmarkt-roncalli"
      title = '',
      date  = '',
      name,
      email = '',
      guests = 1,
      note = ''
    } = body || {};

    if (!eventId || !name) {
      return res.status(400).json({ ok: false, error: 'Missing eventId or name' });
    }

    // 1) RSVP-Datei aus Repo lesen
    const owner = 'Friedwart';
    const repo  = 'iwc-hilden-haan-neandertal';
    const path  = 'content/rsvp.json'; // <— Datei liegt hier
    const gh    = await ghGetFile(owner, repo, path);
    const items = gh.json?.items ?? [];

    // 2) Neuen Eintrag anhängen
    const nowISO = new Date().toISOString();
    items.push({
      id: `${eventId}__${nowISO}`,
      eventId,
      title,
      date,
      name,
      email,
      guests,
      note,
      createdAt: nowISO
    });

    // 3) Datei zurückschreiben
    const content = JSON.stringify({ items }, null, 2) + '\n';
    await ghPutFile(owner, repo, path, content, gh.sha, 'Add RSVP entry via API');

    return res.status(200).json({ ok: true, saved: { eventId, name, guests } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

/* ---------------- Helpers ---------------- */

async function parseNodeRequestBody(req) {
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const GH_BASE = 'https://api.github.com';
const GH_TOKEN = process.env.GITHUB_TOKEN;

async function ghGetFile(owner, repo, path) {
  const url = `${GH_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const r = await fetch(url, {
    headers: { 'Authorization': `Bearer ${GH_TOKEN}`, 'Accept': 'application/vnd.github+json' }
  });
  if (!r.ok) throw new Error(`GitHub GET failed: ${r.status} ${await r.text()}`);
  const json = await r.json();
  const content = Buffer.from(json.content, 'base64').toString('utf8');
  return { sha: json.sha, json: JSON.parse(content) };
}

async function ghPutFile(owner, repo, path, rawContent, sha, message) {
  const url = `${GH_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message,
    content: Buffer.from(rawContent, 'utf8').toString('base64'),
    sha
  };
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`GitHub PUT failed: ${r.status} ${await r.text()}`);
}
