// File: api/save-events.js
// Serverless-Funktion (Vercel) zum Speichern von content/events.json in GitHub

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    const token  = process.env.GITHUB_TOKEN;
    const repo   = process.env.GITHUB_REPO   || 'Friedwart/iwc-hilden-haan-neandertal';
    const branch = process.env.GITHUB_BRANCH || 'main';
    const path   = process.env.EVENTS_PATH   || 'content/events.json';

    if (!token)  throw new Error('Missing GITHUB_TOKEN');
    if (!repo)   throw new Error('Missing GITHUB_REPO');
    if (!path)   throw new Error('Missing EVENTS_PATH');

    const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    if (!body || !Array.isArray(body.items)) {
      return res.status(400).json({ ok: false, error: 'Invalid payload: expected { items: [...] }' });
    }

    const apiBase = 'https://api.github.com';
    const getUrl  = `${apiBase}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;

    let sha = undefined;
    {
      const r = await fetch(getUrl, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'vercel-save-events' }
      });
      if (r.ok) {
        const j = await r.json();
        sha = j.sha; // vorhandene Datei -> Update
      } else if (r.status !== 404) {
        const t = await r.text();
        return res.status(502).json({ ok: false, error: 'GitHub read failed', detail: t });
      }
    }

    const contentJson = JSON.stringify({ items: body.items }, null, 2) + '\n';
    const contentB64  = Buffer.from(contentJson, 'utf8').toString('base64');

    const putUrl = `${apiBase}/repos/${repo}/contents/${encodeURIComponent(path)}`;
    const commitMessage = `Update ${path} via Admin (Vercel)`;

    const putResp = await fetch(putUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'vercel-save-events'
      },
      body: JSON.stringify({
        message: commitMessage,
        content: contentB64,
        sha,              // undefined => neue Datei; ansonsten Update
        branch,
        committer: { name: 'IWC Admin', email: 'admin@iwc-app.local' }
      })
    });

    if (!putResp.ok) {
      const txt = await putResp.text();
      return res.status(502).json({ ok: false, error: 'GitHub write failed', detail: txt });
    }

    const result = await putResp.json();
    return res.status(200).json({ ok: true, path, branch, commit: result?.commit?.sha || null });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } }
};
