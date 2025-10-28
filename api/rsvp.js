// api/rsvp.js
// Speichert RSVP-Einträge und versendet Bestätigungsmail via Resend API

import { Resend } from 'resend';

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET" && (req.query.health || req.query.health === "1")) {
    return res.status(200).json({ ok: true, message: "rsvp alive" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { eventId, title, date, name, email, guests, note } = await req.json();

    if (!eventId || !name || !email) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    // RSVP in Datei speichern (wie bisher)
    const newEntry = {
      id: `${eventId}__${new Date().toISOString()}`,
      eventId,
      title,
      date,
      name,
      email,
      guests: guests || 1,
      note: note || "",
      createdAt: new Date().toISOString(),
    };

    // Schreibe in rsvp.json via GitHub API
    const fs = require("fs");
    const path = "content/rsvp.json";
    const data = JSON.parse(fs.readFileSync(path, "utf-8"));
    data.items.push(newEntry);
    fs.writeFileSync(path, JSON.stringify(data, null, 2));

    // ====== E-Mail-Versand via Resend ======
    const resend = new Resend(process.env.RESEND_API_KEY);

    // an Teilnehmer
    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: `Bestätigung: ${title}`,
      html: `
        <p>Liebe/r ${name},</p>
        <p>vielen Dank für deine Anmeldung zu <strong>${title}</strong> am ${date}.</p>
        <p>Wir freuen uns auf dich!</p>
        <p>Herzliche Grüße,<br>Inner Wheel Club Hilden–Haan–Neandertal</p>
      `
    });

    // an Admin
    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_ADMIN,
      subject: `Neue Anmeldung: ${title}`,
      html: `
        <p>${name} (${email}) hat sich für <strong>${title}</strong> am ${date} angemeldet.</p>
        <p>Notiz: ${note || "–"}</p>
      `
    });

    return res.status(200).json({ ok: true, saved: newEntry });

  } catch (error) {
    console.error("RSVP error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
