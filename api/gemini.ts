// api/gemini.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Simple in-memory cache (per serverless instance)
type CacheVal = { expiresAt: number; value: any };
const CACHE = new Map<string, CacheVal>();
const CACHE_TTL_MS = 1000 * 60 * 10; // 10 minutes

function getKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY environment variable");
  return key;
}

function cacheGet(key: string) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    CACHE.delete(key);
    return null;
  }
  return hit.value;
}
function cacheSet(key: string, value: any) {
  CACHE.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Try to extract text from Gemini REST response safely
function extractText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((p: any) => p?.text).filter(Boolean).join("");
}

async function generateContentRaw(opts: {
  apiKey: string;
  model: string;
  prompt: string;
  maxOutputTokens: number;
  temperature: number;
}) {
  const url = `${API_BASE}/models/${encodeURIComponent(opts.model)}:generateContent`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": opts.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: opts.prompt }] }],
      generationConfig: {
        maxOutputTokens: opts.maxOutputTokens,
        temperature: opts.temperature,
      },
    }),
  });

  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

function buildStructuredPrompt(userPrompt: string) {
  // Force JSON ONLY. No markdown. No headings with #.
  return `
You are a CCNA tutor. Return ONLY valid JSON that matches this exact schema (no extra keys):
{
  "title": "string",
  "simpleExplanation": "string",
  "realWorldExample": "string",
  "keyCommands": ["string"],
  "commonMistakes": ["string"],
  "quickCheck": ["string"]
}

Rules:
- No markdown, no backticks, no extra commentary.
- Keep each string concise but complete.
- If no commands apply, return an empty array for keyCommands.
- Provide at least 2 items in commonMistakes and quickCheck when possible.

USER REQUEST:
${userPrompt}
`.trim();
}

function safeJsonParseMaybe(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const apiKey = getKey();

    // Healthcheck
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, hint: "POST { prompt }" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { prompt, model } = (req.body ?? {}) as { prompt?: string; model?: string };

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing 'prompt' in JSON body" });
    }

    const chosenModel = (typeof model === "string" && model.trim()) ? model.trim() : DEFAULT_MODEL;

    // Cache key should include model + prompt
    const cacheKey = `${chosenModel}::${prompt}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({ cached: true, model: chosenModel, result: cached });
    }

    const structuredPrompt = buildStructuredPrompt(prompt);

    // First attempt
    const first = await generateContentRaw({
      apiKey,
      model: chosenModel,
      prompt: structuredPrompt,
      maxOutputTokens: 1200,
      temperature: 0.6,
    });

    if (!String(first.status).startsWith("2")) {
      return res.status(500).json({
        error: "Gemini request failed",
        status: first.status,
        details: first.data,
        model: chosenModel,
      });
    }

    let text = extractText(first.data);
    let json = safeJsonParseMaybe(text);

    // If it got cut off OR JSON parse failed, do ONE continuation call
    const finishReason = first.data?.candidates?.[0]?.finishReason;
    if ((!json || finishReason === "MAX_TOKENS") && text) {
      const continuePrompt = `
The previous JSON was incomplete or cut off.
Continue by returning ONLY the remaining JSON text so that the final result becomes a valid JSON object matching the schema.
Do NOT restart. Do NOT add markdown. Continue exactly where it cut off.

PARTIAL OUTPUT SO FAR:
${text}
`.trim();

      const second = await generateContentRaw({
        apiKey,
        model: chosenModel,
        prompt: continuePrompt,
        maxOutputTokens: 900,
        temperature: 0.3,
      });

      if (String(second.status).startsWith("2")) {
        const t2 = extractText(second.data);
        const merged = (text + t2).trim();
        const j2 = safeJsonParseMaybe(merged);
        if (j2) {
          text = merged;
          json = j2;
        }
      }
    }

    // Final fallback if still not JSON: wrap as simpleExplanation
    if (!json) {
      json = {
        title: "AI Tutor",
        simpleExplanation: text || "No explanation returned.",
        realWorldExample: "",
        keyCommands: [],
        commonMistakes: [],
        quickCheck: [],
      };
    }

    cacheSet(cacheKey, json);

    return res.status(200).json({
      cached: false,
      model: chosenModel,
      result: json,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
