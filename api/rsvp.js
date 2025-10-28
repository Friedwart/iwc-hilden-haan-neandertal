// api/rsvp.js
// Speichert RSVPs in content/rsvp.json via GitHub API und versendet Mails mit Resend

// ---- Konfiguration ----
const OWNER = "Friedwart";
const REPO  = "iwc-hilden-haan-neandertal";
const FILE_PATH = "content/rsvp.json";
const BRANCH = "main";

// ---- Helpers: Body lesen (Node/Vercel) ----
async function readRequestBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  try { return JSON.parse(body || "{}"); } catch { return {}; }
}

// ---- Helpers: GitHub API ----
async function ghRequest(path, method, token, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub ${method} ${path} failed: ${res.status} – ${txt}`);
  }
  return res.json();
}

async function readJsonFileFromGitHub(token) {
  // file metadata + content (base64)
  const data = await ghRequest(
    `/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(FILE_PATH)}?ref=${BRANCH}`,
    "GET",
    token
  );
  const json = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));
  return { json, sha: data.sha };
}

async function writeJsonFileToGitHub(token, updatedJson, prevSha, message) {
  const contentB64 = Buffer.from(JSON.stringify(updatedJson, null, 2), "utf-8").toString("base64");
  return ghRequest(
    `/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(FILE_PATH)}`,
    "PUT",
    token,
    {
      message,
      content: contentB64,
      sha: prevSha,
      branch: BRANCH
    }
  );
}

// ---- Resend ----
async function sendEmail(resendApiKey, payload) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Resend failed: ${res.status} – ${txt}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();

  // Health
  if (req.method === "GET" && (req.query.health || req.query.health === "1")) {
    return res.status(200).json({ ok: true, message: "rsvp alive" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    // ---- 1) Payload einlesen ----
    const { eventId, title, date, name, email, guests, note } = await readRequestBody(req);
    if (!eventId || !name || !email) {
      return res.status(400).json({ ok: false, error: "Missing required fields (eventId, name, email)" });
    }

    // ---- 2) Eintrag erstellen ----
    const entry = {
      id: `${eventId}__${new Date().toISOString()}`,
      eventId,
      title: title || "",
      date: date || "",
      name,
      email,
      guests: Number(guests || 1),
      note: note || "",
      createdAt: new Date().toISOString()
    };

    // ---- 3) GitHub schreiben ----
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    if (!GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set in Vercel env");

    const { json, sha } = await readJsonFileFromGitHub(GITHUB_TOKEN);
    if (!json.items || !Array.isArray(json.items)) json.items = [];
    json.items.push(entry);

    await writeJsonFileToGitHub(
      GITHUB_TOKEN,
      json,
      sha,
      `Add RSVP entry via API (${entry.eventId})`
    );

    // ---- 4) Mails via Resend ----
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const EMAIL_FROM     = process.env.EMAIL_FROM;   // z.B. "IWC <onboarding@resend.dev>" (oder verifizierte Domain)
    const EMAIL_ADMIN    = process.env.EMAIL_ADMIN;  // deine Admin-Mail

    if (!RESEND_API_KEY || !EMAIL_FROM) {
      // Wir speichern trotzdem, schicken aber einen klaren Hinweis zurück
      return res.status(200).json({
        ok: true,
        saved: entry,
        mail: "skipped (missing RESEND_API_KEY or EMAIL_FROM)"
      });
    }

    // Teilnehmer-Bestätigung
    await sendEmail(RESEND_API_KEY, {
      from: EMAIL_FROM,
      to: email,
      subject: `Bestätigung: ${entry.title || "Veranstaltung"}`,
      html: `
        <p>Liebe/r ${entry.name},</p>
        <p>vielen Dank für deine Anmeldung${entry.title ? ` zu <strong>${entry.title}</strong>` : ""}${entry.date ? ` am ${entry.date}` : ""}.</p>
        <p>Wir freuen uns auf dich!</p>
        <p style="margin-top:16px;font-size:12px;color:#555">Hinweis: ${entry.note || "–"}</p>
        <p style="margin-top:24px">Herzliche Grüße<br>Inner Wheel Club Hilden–Haan–Neandertal</p>
      `
    });

    // Admin-Info (optional)
    if (EMAIL_ADMIN) {
      await sendEmail(RESEND_API_KEY, {
        from: EMAIL_FROM,
        to: EMAIL_ADMIN,
        subject: `Neue Anmeldung: ${entry.title || "Event"}`,
        html: `
          <p><strong>${entry.name}</strong> (${entry.email}) hat sich angemeldet.</p>
          <p>Event: ${entry.title || "–"}<br>
             Datum: ${entry.date || "–"}<br>
             Personen: ${entry.guests}<br>
             Notiz: ${entry.note || "–"}</p>
          <p>Zeit: ${entry.createdAt}</p>
        `
      });
    }

    return res.status(200).json({ ok: true, saved: entry });

  } catch (err) {
    console.error("RSVP error:", err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
