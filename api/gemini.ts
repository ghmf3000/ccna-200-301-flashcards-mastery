// api/gemini.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function getKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY environment variable");
  return key;
}

async function generateContent(key: string, model: string, prompt: string, maxOutputTokens = 900) {
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

// Extract text from Gemini response (handles multiple parts safely)
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

    // 1st attempt
    const out1 = await generateContent(key, chosenModel, prompt, 900);

    if (!String(out1.status).startsWith("2")) {
      return res.status(500).json({
        error: "Gemini request failed",
        status: out1.status,
        details: out1.data,
        model: chosenModel,
      });
    }

    let text = extractText(out1.data);
    const finishReason = out1.data?.candidates?.[0]?.finishReason;

    // If truncated, do ONE continuation call
    if (finishReason === "MAX_TOKENS" && text.length > 0) {
      const continuePrompt =
        `Continue EXACTLY where you left off. Do not repeat. ` +
        `Pick up mid-sentence if needed.\n\n---\n\nPREVIOUS OUTPUT:\n${text}\n\n---\n\nCONTINUE:`;

      const out2 = await generateContent(key, chosenModel, continuePrompt, 700);

      if (String(out2.status).startsWith("2")) {
        const text2 = extractText(out2.data);
        if (text2) text = text + "\n\n" + text2;
      }
    }

    // If Gemini returns empty (rare), send a helpful fallback
    if (!text.trim()) {
      text = "I couldn’t generate a full explanation for that one. Try again or ask a slightly different question.";
    }

    return res.status(200).json({ text, model: chosenModel, finishReason });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
