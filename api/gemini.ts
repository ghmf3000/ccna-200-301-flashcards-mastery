// api/gemini.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function getKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY environment variable");
  return key;
}

// --- Simple server-side cache (best-effort, works within warm instances) ---
type CacheEntry = { value: any; expiresAt: number };
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h

function getCache(): Map<string, CacheEntry> {
  const g = globalThis as any;
  if (!g.__geminiCache) g.__geminiCache = new Map<string, CacheEntry>();
  return g.__geminiCache as Map<string, CacheEntry>;
}

function hashKey(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function cacheGet(key: string) {
  const cache = getCache();
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key: string, value: any) {
  const cache = getCache();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// --- REST JSON (non-stream) ---
async function generateContentJSON(key: string, model: string, prompt: string) {
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
        // Higher to avoid cutoffs
        maxOutputTokens: 1400,
        temperature: 0.6,
      },
    }),
  });

  const data = await r.json();
  return { status: r.status, data };
}

// --- STREAM (SSE) ---
async function streamGenerateContent(
  key: string,
  model: string,
  prompt: string
): Promise<Response> {
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  return fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 1400,
        temperature: 0.6,
      },
    }),
  });
}

function extractTextFromCandidate(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p: any) => p?.text).filter(Boolean).join("");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const key = getKey();

    // Healthcheck
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, hint: "POST { prompt } or POST { prompt, stream: true }" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = (req.body ?? {}) as {
      prompt?: string;
      model?: string;
      stream?: boolean;
    };

    const prompt = body.prompt;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing 'prompt' in JSON body" });
    }

    const chosenModel =
      (typeof body.model === "string" && body.model.trim()) ||
      process.env.GEMINI_MODEL ||
      "gemini-2.5-flash";

    // Cache key includes model+prompt
    const ck = hashKey(`${chosenModel}||${prompt}`);

    // If NOT streaming, try server cache first
    if (!body.stream) {
      const cached = cacheGet(ck);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        return res.status(200).json(cached);
      }

      const out = await generateContentJSON(key, chosenModel, prompt);

      if (!String(out.status).startsWith("2")) {
        return res.status(500).json({
          error: "Gemini request failed",
          status: out.status,
          details: out.data,
          model: chosenModel,
        });
      }

      const text = extractTextFromCandidate(out.data);
      const payload = { text, model: chosenModel };

      cacheSet(ck, payload);
      res.setHeader("X-Cache", "MISS");
      return res.status(200).json(payload);
    }

    // STREAMING MODE:
    // If cache hit, we can stream it instantly as a single event.
    const cached = cacheGet(ck);
    if (cached?.text) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      res.write(`event: meta\ndata: ${JSON.stringify({ model: chosenModel, cached: true })}\n\n`);
      res.write(`event: chunk\ndata: ${JSON.stringify({ delta: cached.text })}\n\n`);
      res.write(`event: done\ndata: ${JSON.stringify({ finishReason: "CACHED" })}\n\n`);
      return res.end();
    }

    const upstream = await streamGenerateContent(key, chosenModel, prompt);

    if (!upstream.ok || !upstream.body) {
      const details = await upstream.text().catch(() => "");
      return res.status(500).json({
        error: "Gemini stream request failed",
        status: upstream.status,
        details,
        model: chosenModel,
      });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    res.write(`event: meta\ndata: ${JSON.stringify({ model: chosenModel, cached: false })}\n\n`);

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let fullText = "";
    let finishReason: string | undefined;

    // Upstream is SSE already. We pass through in a simplified event format.
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // split by SSE message separator
      const messages = buffer.split("\n\n");
      buffer = messages.pop() || "";

      for (const msg of messages) {
        // upstream lines like: "data: {json}"
        const lines = msg.split("\n").map((l) => l.trim());
        const dataLine = lines.find((l) => l.startsWith("data:"));
        if (!dataLine) continue;

        const jsonStr = dataLine.replace(/^data:\s*/, "");
        if (jsonStr === "[DONE]") continue;

        try {
          const payload = JSON.parse(jsonStr);

          const delta = extractTextFromCandidate(payload);
          if (delta) {
            fullText += delta;
            res.write(`event: chunk\ndata: ${JSON.stringify({ delta })}\n\n`);
          }

          // Try to capture finishReason
          const fr = payload?.candidates?.[0]?.finishReason;
          if (fr) finishReason = fr;
        } catch {
          // ignore parse errors for non-json chunks
        }
      }
    }

    // Cache the full result for next time
    cacheSet(ck, { text: fullText, model: chosenModel });

    res.write(`event: done\ndata: ${JSON.stringify({ finishReason: finishReason || "DONE" })}\n\n`);
    return res.end();
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
