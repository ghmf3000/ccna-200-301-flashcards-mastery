// api/gemini.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Safety caps (prevents runaway bills/latency)
const MAX_CONTINUES = 4; // how many times we auto-continue after MAX_TOKENS
const MAX_TOTAL_CHARS = 18000; // hard cap on combined output

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

type GenOut = {
  status: number;
  data: any;
  text: string;
  finishReason: string | null;
};

function extractTextAndFinish(data: any): { text: string; finishReason: string | null } {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text =
    parts
      .map((p: any) => p?.text)
      .filter(Boolean)
      .join("") || "";

  // Gemini APIs sometimes place finishReason on candidate
  const finishReason = candidate?.finishReason ?? candidate?.finishReason?.toString?.() ?? null;

  return { text, finishReason };
}

async function generateContent(
  key: string,
  model: string,
  prompt: string,
  generationConfig?: { maxOutputTokens?: number; temperature?: number }
): Promise<GenOut> {
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
        maxOutputTokens: generationConfig?.maxOutputTokens ?? 1200,
        temperature: generationConfig?.temperature ?? 0.6,
      },
    }),
  });

  const data = await r.json();
  const { text, finishReason } = extractTextAndFinish(data);
  return { status: r.status, data, text, finishReason };
}

/**
 * Auto-continue if finishReason === MAX_TOKENS.
 * We ask the model to continue exactly where it left off, with minimal repetition.
 */
async function generateWithAutoContinue(opts: {
  key: string;
  model: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}) {
  const { key, model, prompt, maxOutputTokens, temperature } = opts;

  let combined = "";
  let finishReason: string | null = null;

  // 1st call
  const first = await generateContent(key, model, prompt, { maxOutputTokens, temperature });

  if (!String(first.status).startsWith("2")) {
    return {
      ok: false,
      status: first.status,
      details: first.data,
      model,
    };
  }

  combined += first.text;
  finishReason = first.finishReason;

  // Continue loop
  let continues = 0;
  while (
    finishReason === "MAX_TOKENS" &&
    continues < MAX_CONTINUES &&
    combined.length < MAX_TOTAL_CHARS
  ) {
    continues++;

    // Provide a small tail to reduce repetition risk
    const tail = combined.slice(-800);

    const continuePrompt = [
      "Continue EXACTLY from where you stopped.",
      "Do NOT repeat earlier sentences.",
      "Do NOT restart sections.",
      "Keep the same tone, formatting, and structure.",
      "",
      "Last part of your previous output (for reference):",
      tail,
      "",
      "Continue now:",
    ].join("\n");

    const next = await generateContent(key, model, continuePrompt, {
      maxOutputTokens: Math.min(maxOutputTokens ?? 1200, 1200),
      temperature: temperature ?? 0.6,
    });

    if (!String(next.status).startsWith("2")) {
      // If continuation fails, stop and return what we have
      break;
    }

    // Append carefully: trim leading whitespace to reduce accidental gaps
    const chunk = (next.text || "").replace(/^\s+/, "");
    combined += chunk;
    finishReason = next.finishReason;

    if (!chunk) break;
  }

  // Final cleanup: avoid huge trailing whitespace
  combined = combined.replace(/\n{4,}/g, "\n\n\n").trim();

  return {
    ok: true,
    status: 200,
    model,
    finishReason,
    continued: continues,
    text: combined,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const key = getKey();

    // GET /api/gemini -> healthcheck or model listing
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

    const { prompt, model, maxOutputTokens, temperature } = (req.body ?? {}) as {
      prompt?: string;
      model?: string;
      maxOutputTokens?: number;
      temperature?: number;
    };

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing 'prompt' in JSON body" });
    }

    // Default model (you can also set GEMINI_MODEL in Vercel env vars)
    const chosenModel =
      (typeof model === "string" && model.trim()) ||
      process.env.GEMINI_MODEL ||
      "gemini-2.5-flash";

    const out = await generateWithAutoContinue({
      key,
      model: chosenModel,
      prompt,
      maxOutputTokens: typeof maxOutputTokens === "number" ? maxOutputTokens : 1400,
      temperature: typeof temperature === "number" ? temperature : 0.6,
    });

    if (!out.ok) {
      // If model not found, show helpful debug
      if (out.status === 404) {
        return res.status(404).json({
          error: "Model not found for this API key / endpoint",
          triedModel: chosenModel,
          details: out.details,
          hint: "Open /api/gemini?list=1 to see models available for your key.",
        });
      }

      return res.status(500).json({
        error: "Gemini request failed",
        status: out.status,
        details: out.details,
        model: chosenModel,
      });
    }

    return res.status(200).json({
      text: out.text,
      model: out.model,
      finishReason: out.finishReason,
      continued: out.continued,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
