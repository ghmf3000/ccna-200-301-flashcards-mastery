// api/gemini.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function getKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY environment variable");
  return key;
}

async function listModels(key: string) {
  const r = await fetch(`${API_BASE}/models`, {
    headers: { "x-goog-api-key": key },
  });
  const data = await r.json();
  return { status: r.status, data };
}

async function generateContent(key: string, model: string, prompt: string) {
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
  contents: [{ parts: [{ text: prompt }]}],
  generationConfig: {
    maxOutputTokens: 400,
    temperature: 0.65
  }
}),
});

  const data = await r.json();
  return { status: r.status, data };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const key = getKey();

    // GET /api/gemini  -> healthcheck (or list models)
    if (req.method === "GET") {
      if (req.query.list === "1") {
        const out = await listModels(key);
        return res.status(out.status).json(out.data);
      }
      return res.status(200).json({ ok: true, hint: "Send POST with { prompt } or GET ?list=1" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { prompt, model } = (req.body ?? {}) as { prompt?: string; model?: string };

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing 'prompt' in JSON body" });
    }

    // Default to a model that’s shown in current Gemini API docs examples (v1beta)
    // You can override by POSTing { model: "..." } or setting GEMINI_MODEL env var.
    const chosenModel =
      (typeof model === "string" && model.trim()) ||
      process.env.GEMINI_MODEL ||
      "gemini-2.5-flash";

    const out = await generateContent(key, chosenModel, prompt);

    // If model not found, return helpful debug data
    if (out.status === 404) {
      return res.status(404).json({
        error: "Model not found for this API key / endpoint",
        triedModel: chosenModel,
        details: out.data,
        hint: "Open /api/gemini?list=1 to see available models for your key, then use one of those names.",
      });
    }

    if (!String(out.status).startsWith("2")) {
      return res.status(500).json({
        error: "Gemini request failed",
        status: out.status,
        details: out.data,
        model: chosenModel,
      });
    }

    // Extract text safely
    const text =
      out.data?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p?.text)
        ?.filter(Boolean)
        ?.join("") ?? "";

    return res.status(200).json({ text, model: chosenModel });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
