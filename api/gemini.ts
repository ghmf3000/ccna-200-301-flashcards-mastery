// api/gemini.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function getKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY environment variable");
  return key;
}

async function generateContent(key: string, model: string, prompt: string, maxOutputTokens: number) {
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens,
        temperature: 0.6,
      },
    }),
  });

  const data = await r.json();
  return { status: r.status, data };
}

function extractText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((p: any) => p?.text).filter(Boolean).join("");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const key = getKey();

    if (req.method === "GET") {
      return res.status(200).json({ ok: true, hint: "Send POST with { prompt }" });
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

    // First call (bigger cap)
    const out1 = await generateContent(key, chosenModel, prompt, 1400);

    if (!String(out1.status).startsWith("2")) {
      return res.status(500).json({
        error: "Gemini request failed",
        status: out1.status,
        details: out1.data,
        model: chosenModel,
      });
    }

    let text = extractText(out1.data);
    let finishReason = out1.data?.candidates?.[0]?.finishReason;

    // Auto-continue up to TWO times if truncated
    for (let i = 0; i < 2 && finishReason === "MAX_TOKENS" && text.trim().length > 0; i++) {
      const continuePrompt =
        `Continue EXACTLY where you left off. Do NOT repeat earlier text.\n\n` +
        `---\nPREVIOUS OUTPUT:\n${text}\n---\nCONTINUE:`;

      const outN = await generateContent(key, chosenModel, continuePrompt, 1200);

      if (!String(outN.status).startsWith("2")) break;

      const more = extractText(outN.data);
      if (!more.trim()) break;

      text = text + "\n\n" + more;
      finishReason = outN.data?.candidates?.[0]?.finishReason;
    }

    return res.status(200).json({ text, model: chosenModel, finishReason });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
