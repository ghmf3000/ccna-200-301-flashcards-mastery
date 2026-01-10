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

type GenResult = {
  status: number;
  data: any;
  text: string;
  finishReason?: string;
};

function extractText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p: any) => p?.text).filter(Boolean).join("");
}

function getFinishReason(data: any): string | undefined {
  return data?.candidates?.[0]?.finishReason;
}

async function generateOnce(key: string, model: string, prompt: string): Promise<GenResult> {
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      // Higher limit reduces cutoffs; still safe for speed.
      generationConfig: {
        maxOutputTokens: 1400,
        temperature: 0.6,
      },
    }),
  });

  const data = await r.json();
  return {
    status: r.status,
    data,
    text: extractText(data),
    finishReason: getFinishReason(data),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const key = getKey();

    // GET /api/gemini (healthcheck) or /api/gemini?list=1 (debug models)
    if (req.method === "GET") {
      if (req.query.list === "1") {
        const out = await listModels(key);
        return res.status(out.status).json(out.data);
      }
      return res.status(200).json({ ok: true, hint: "POST { prompt }" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { prompt, model } = (req.body ?? {}) as { prompt?: string; model?: string };

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing 'prompt' in JSON body" });
    }

    const chosenModel =
      (typeof model === "string" && model.trim()) ||
      process.env.GEMINI_MODEL ||
      "gemini-2.5-flash";

    // 1) First attempt
    let out = await generateOnce(key, chosenModel, prompt);

    // Helpful 404 response
    if (out.status === 404) {
      return res.status(404).json({
        error: "Model not found for this API key / endpoint",
        triedModel: chosenModel,
        details: out.data,
        hint: "Open /api/gemini?list=1 to see available models for your key.",
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

    // 2) Auto-continue ONLY if it was cut off
    let fullText = out.text;
    let safetyCounter = 0;

    while (out.finishReason === "MAX_TOKENS" && safetyCounter < 2) {
      safetyCounter++;

      const continuationPrompt = [
        "Continue EXACTLY where you left off.",
        "Do NOT restart, do NOT repeat headings, do NOT add introductions.",
        "Output ONLY the remaining content.",
        "-----",
        "CONTENT SO FAR:",
        fullText,
      ].join("\n");

      out = await generateOnce(key, chosenModel, continuationPrompt);

      if (!String(out.status).startsWith("2")) break;

      const more = out.text?.trim();
      if (!more) break;

      // Avoid accidental duplication
      if (!fullText.endsWith("\n")) fullText += "\n";
      fullText += more;
    }

    return res.status(200).json({
      text: fullText,
      model: chosenModel,
      finishReason: out.finishReason || "STOP",
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
