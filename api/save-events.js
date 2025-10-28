// /api/save-events.js
// Speichert content in ein GitHub-Repo (Repo Contents API) via Personal Access Token
// Erwartet JSON: { path: "content/events.json", content: "<stringified JSON>" }
// Optional: ?health=1 -> simple health-check

export default async function handler(req, res) {
  try {
    // Healthcheck
    if (req.method === "GET" && "health" in req.query) {
      return res.status(200).json({ ok: true, message: "save-events alive" });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const token = process.env.GITHUB_TOKEN;
    const repoFull = process.env.GITHUB_REPO || "Friedwart/iwc-hilden-haan-neandertal";
    const branch = process.env.GITHUB_BRANCH || "main";

    if (!token) {
      return res.status(500).json({ error: "GITHUB_TOKEN missing" });
    }

    const { path, content } = req.body || {};
    if (!path || typeof content !== "string") {
      return res.status(400).json({ error: "Body must include { path, content }" });
    }

    const [owner, repo] = repoFull.split("/");
    const apiBase = "https://api.github.com";

    // 1) SHA der bestehenden Datei holen (falls vorhanden)
    let sha = null;
    {
      const r = await fetch(
        `${apiBase}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
      );
      if (r.status === 200) {
        const j = await r.json();
        sha = j.sha;
      } else if (r.status !== 404) {
        const txt = await r.text();
        return res.status(502).json({ error: "Failed to read file", status: r.status, detail: txt });
      }
    }

    // 2) Commit vorbereiten
    const now = new Date().toISOString();
    const message = `Update ${path} via Admin (${now})`;

    const putBody = {
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      ...(sha ? { sha } : {})
    };

    const putRes = await fetch(
      `${apiBase}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(putBody)
      }
    );

    if (!putRes.ok) {
      const txt = await putRes.text();
      return res.status(502).json({ error: "GitHub PUT failed", status: putRes.status, detail: txt });
    }

    const result = await putRes.json();
    return res.status(200).json({ ok: true, path, commit: result.commit && result.commit.sha });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unhandled error", detail: String(err) });
  }
}
