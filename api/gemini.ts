// api/gemini.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

type TutorJSON = {
  title: string;
  simpleExplanation: string;
  realWorldExample: string;
  keyCommands: string[];
  commonMistakes: string[];
  quickCheck: string[];
};

function getKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY environment variable");
  return key;
}

function safeJsonExtract(s: string): string | null {
  if (!s) return null;
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return s.slice(first, last + 1);
}

function tryParseTutorJSON(raw: string): TutorJSON | null {
  // 1) direct JSON
  try {
    const obj = JSON.parse(raw);
    return obj as TutorJSON;
  } catch {}

  // 2) extract { ... } region
  const extracted = safeJsonExtract(raw);
  if (!extracted) return null;

  try {
    const obj = JSON.parse(extracted);
    return obj as TutorJSON;
  } catch {}

  return null;
}

function normalizeTutorJSON(obj: Partial<TutorJSON>): TutorJSON {
  return {
    title: String(obj.title ?? "").trim() || "AI Tutor",
    simpleExplanation: String(obj.simpleExplanation ?? "").trim(),
    realWorldExample: String(obj.realWorldExample ?? "").trim(),
    keyCommands: Array.isArray(obj.keyCommands) ? obj.keyCommands.map(String).filter(Boolean) : [],
    commonMistakes: Array.isArray(obj.commonMistakes) ? obj.commonMistakes.map(String).filter(Boolean) : [],
    quickCheck: Array.isArray(obj.quickCheck) ? obj.quickCheck.map(String).filter(Boolean) : [],
  };
}

function needsRepair(obj: TutorJSON) {
  // if key sections are missing/empty, trigger a one-time repair call
  return (
    !obj.simpleExplanation ||
    !obj.realWorldExample ||
    obj.keyCommands.length === 0 ||
    obj.commonMistakes.length === 0
  );
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
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        // near-zero cutoffs + still fast
        maxOutputTokens: 1100,
        temperature: 0.6,

        // IMPORTANT: force JSON output
        responseMimeType: "application/json",
      },
    }),
  });

  const data = await r.json();
  return { status: r.status, data };
}

function getTextFromGeminiResponse(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((p: any) => p?.text).filter(Boolean).join("");
}

function buildJsonPrompt(conceptPrompt: string) {
  return `
You are a CCNA tutor. Return ONLY valid JSON (no markdown, no code fences, no extra text).

JSON SCHEMA:
{
  "title": string,
  "simpleExplanation": string,
  "realWorldExample": string,
  "keyCommands": string[],
  "commonMistakes": string[],
  "quickCheck": string[]
}

RULES:
- Do NOT include hashtags.
- Every field must be present.
- keyCommands/commonMistakes/quickCheck must be arrays (can be empty, but try to include at least 2 items each when relevant).
- Keep it concise, practical, and human-sounding.

USER REQUEST:
${conceptPrompt}
`.trim();
}

function buildRepairPrompt(originalRequest: string, badOutput: string) {
  return `
You returned output that was missing fields or not valid JSON.

Fix it and return ONLY valid JSON that matches the schema exactly.

ORIGINAL REQUEST:
${originalRequest}

BAD OUTPUT:
${badOutput}
`.trim();
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

    // 1) Primary call (forced JSON)
    const jsonPrompt = buildJsonPrompt(prompt);
    const out1 = await generateContent(key, chosenModel, jsonPrompt);

    if (!String(out1.status).startsWith("2")) {
      return res.status(500).json({
        error: "Gemini request failed",
        status: out1.status,
        details: out1.data,
        model: chosenModel,
      });
    }

    const raw1 = getTextFromGeminiResponse(out1.data);
    let parsed = tryParseTutorJSON(raw1);
    let normalized = parsed ? normalizeTutorJSON(parsed) : null;

    // 2) One-time repair if missing sections / parse failed
    if (!normalized || needsRepair(normalized)) {
      const repairPrompt = buildRepairPrompt(prompt, raw1);
      const out2 = await generateContent(key, chosenModel, repairPrompt);

      if (String(out2.status).startsWith("2")) {
        const raw2 = getTextFromGeminiResponse(out2.data);
        const parsed2 = tryParseTutorJSON(raw2);
        if (parsed2) normalized = normalizeTutorJSON(parsed2);
      }
    }

    // 3) Final response: ALWAYS return structured object
    if (!normalized) {
      return res.status(200).json({
        ok: true,
        model: chosenModel,
        data: normalizeTutorJSON({
          title: "AI Tutor",
          simpleExplanation: raw1 || "No explanation available.",
          realWorldExample: "",
          keyCommands: [],
          commonMistakes: [],
          quickCheck: [],
        }),
        // keep raw only for debugging
        raw: raw1,
      });
    }

    return res.status(200).json({ ok: true, model: chosenModel, data: normalized });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
