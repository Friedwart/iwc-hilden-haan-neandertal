// api/rsvp.js
// Speichert RSVP-Einträge in content/rsvps.json via GitHub API (wie save-events.js)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const {
      eventId,       // z.B. "2025-12-05_weihnachtsmarkt-roncalli"
      title,         // Anzeigezwecke
      date,          // ISO (YYYY-MM-DD)
      name,          // Pflicht
      email,         // optional
      guests = 1,    // optional
      note = ""      // optional
    } = await req.json?.() || await parseNodeRequestBody(req);

    if (!eventId || !name) {
      return res.status(400).json({ ok: false, error: "Missing eventId or name" });
    }

    const repo = process.env.VERCEL_GIT_REPO_SLUG || "iwc-hilden-haan-neandertal";
    const owner = process.env.VERCEL_GIT_REPO_OWNER || "Friedwart";
    const filePath = "content/rsvps.json";
    const token = process.env.GITHUB_TOKEN;

    if (!token) return res.status(500).json({ ok: false, error: "GITHUB_TOKEN missing" });

    // 1) rsvps.json lesen
    const fileResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
    });

    if (!fileResp.ok) {
      const txt = await fileResp.text();
      return res.status(500).json({ ok: false, error: "Read rsvps.json failed", detail: txt });
    }

    const fileJson = await fileResp.json();
    const sha = fileJson.sha;
    const current = JSON.parse(Buffer.from(fileJson.content, "base64").toString("utf-8"));

    // 2) neuen Eintrag anhängen
    const now = new Date().toISOString();
    current.items.push({
      id: `${eventId}__${now}`,
      eventId, title, date, name, email, guests,
      note, created_at: now
    });

    // 3) zurückschreiben
    const newContentB64 = Buffer.from(JSON.stringify(current, null, 2), "utf-8").toString("base64");

    const commitResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "Add RSVP via /api/rsvp",
        content: newContentB64,
        sha
      })
    });

    if (!commitResp.ok) {
      const txt = await commitResp.text();
      return res.status(500).json({ ok: false, error: "Commit failed", detail: txt });
    }

    return res.status(200).json({ ok: true, message: "RSVP saved" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}

// Helfer für Node-Umgebung (Vercel) ohne req.json()
async function parseNodeRequestBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}
