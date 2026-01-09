import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow quick browser check
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, hint: "Send POST with { prompt }" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  try {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent" +
      `?key=${encodeURIComponent(apiKey)}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: String(prompt) }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 800,
        },
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json({
        error: "Gemini request failed",
        details: data,
      });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join("") || "";

    return res.status(200).json({ text });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
