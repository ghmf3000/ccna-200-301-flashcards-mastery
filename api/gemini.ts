import type { VercelRequest, VercelResponse } from "@vercel/node";

const DEFAULT_MODEL = "gemini-1.5-flash"; // you can change later

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS (optional but helpful)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, hint: "Send POST with { prompt }" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
  }

  try {
    const { prompt, model } = (req.body ?? {}) as { prompt?: string; model?: string };

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const useModel = (model && typeof model === "string" ? model : DEFAULT_MODEL).trim();

    // REST endpoint (no SDK, no model listing)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      useModel
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 600,
      },
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await r.json();

    if (!r.ok) {
      // Return Google’s real error so we can see exactly what’s wrong
      return res.status(r.status).json({
        error: "Gemini request failed",
        status: r.status,
        details: data,
        model: useModel,
      });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join("") ?? "";

    return res.status(200).json({ ok: true, text, model: useModel });
  } catch (err: any) {
    return res.status(500).json({
      error: "Server error",
      details: err?.message ?? String(err),
    });
  }
}
