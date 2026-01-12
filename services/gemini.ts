// services/gemini.ts

export type AiTutorResult = {
  title: string;
  simpleExplanation: string;
  realWorldExample: string;
  keyCommands: string[];
  commonMistakes: string[];
  quickCheck: string[];
};

// Back-compat alias (if you referenced TutorJSON elsewhere)
export type TutorJSON = AiTutorResult;

/** ---------------------------
 *  Tiny client cache (instant 2nd click)
 *  --------------------------- */
const memCache = new Map<string, { at: number; value: AiTutorResult }>();
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 min

function cacheKey(concept: string, answerContext?: string) {
  return `${concept}__${answerContext ?? ""}`.trim();
}

function getCached(concept: string, answerContext?: string) {
  const k = cacheKey(concept, answerContext);
  const hit = memCache.get(k);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    memCache.delete(k);
    return null;
  }
  return hit.value;
}

function setCached(concept: string, answerContext: string | undefined, value: AiTutorResult) {
  memCache.set(cacheKey(concept, answerContext), { at: Date.now(), value });
}

/** ---------------------------
 *  Helpers
 *  --------------------------- */
function cleanText(s: unknown): string {
  return (typeof s === "string" ? s : "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => cleanText(x)).filter(Boolean);
  if (typeof v === "string") {
    // split bullets or lines
    return v
      .split(/\n+/)
      .map((x) => x.replace(/^[-*•]\s*/, "").trim())
      .filter(Boolean);
  }
  return [];
}

function looksLikeJsonBlob(s: string) {
  const t = s.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

function tryParseJson<T = any>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

// Extract first plausible {...} block (helps when model wraps JSON in text)
function extractJsonBlock(s: string): string | null {
  const t = s.trim();
  const start = t.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) return t.slice(start, i + 1);
  }
  return null;
}

function normalizeResult(input: Partial<AiTutorResult> | null, fallbackTitle: string): AiTutorResult {
  const title = cleanText(input?.title) || fallbackTitle || "AI Tutor";

  const simpleExplanation = cleanText(input?.simpleExplanation);
  const realWorldExample = cleanText(input?.realWorldExample);

  const keyCommands = asStringArray(input?.keyCommands);
  const commonMistakes = asStringArray(input?.commonMistakes);
  const quickCheck = asStringArray(input?.quickCheck);

  return {
    title,
    simpleExplanation,
    realWorldExample,
    keyCommands,
    commonMistakes,
    quickCheck,
  };
}

/** ---------------------------
 *  Convert plain text into structured sections
 *  --------------------------- */
function parseTextToSections(text: string, fallbackTitle: string): AiTutorResult {
  const t = text.replace(/\r\n/g, "\n").trim();

  // If the whole thing is JSON-ish, try that first
  const directJson = looksLikeJsonBlob(t) ? tryParseJson<any>(t) : null;
  if (directJson && typeof directJson === "object") {
    return normalizeFromAny(directJson, fallbackTitle);
  }

  // Otherwise, parse by headings
  const getBlock = (label: string) => {
    const re = new RegExp(
      String.raw`(?:^|\n)\s*(?:###?\s*)?${label}\s*:?\s*\n([\s\S]*?)(?=\n\s*(?:###?\s*)?(Simple explanation|Real-world example|Key commands|Common mistakes|Quick check)\s*:?\s*\n|$)`,
      "i"
    );
    const m = t.match(re);
    return m ? m[1].trim() : "";
  };

  const se = getBlock("Simple explanation") || "";
  const ex = getBlock("Real-world example") || "";
  const kc = getBlock("Key commands") || "";
  const cm = getBlock("Common mistakes") || "";
  const qc = getBlock("Quick check") || "";

  const out = normalizeResult(
    {
      title: fallbackTitle,
      simpleExplanation: se,
      realWorldExample: ex,
      keyCommands: asStringArray(kc),
      commonMistakes: asStringArray(cm),
      quickCheck: asStringArray(qc),
    },
    fallbackTitle
  );

  // If we failed to find headings, do a graceful fallback:
  if (
    !out.simpleExplanation &&
    !out.realWorldExample &&
    out.keyCommands.length === 0 &&
    out.commonMistakes.length === 0 &&
    out.quickCheck.length === 0
  ) {
    return normalizeResult(
      {
        title: fallbackTitle,
        simpleExplanation: t,
        realWorldExample: "",
        keyCommands: [],
        commonMistakes: [],
        quickCheck: [],
      },
      fallbackTitle
    );
  }

  return out;
}

/** ---------------------------
 *  Normalize from "any" (handles JSON blob inside fields)
 *  --------------------------- */
function normalizeFromAny(anyObj: any, fallbackTitle: string): AiTutorResult {
  // Common shapes: {data:{...}}, {result:{...}}, {text:"..."}
  const obj = anyObj?.data ?? anyObj?.result ?? anyObj;

  // If obj itself is a string, parse as text
  if (typeof obj === "string") return parseTextToSections(obj, fallbackTitle);

  // If Gemini stuck the whole JSON inside a field (common bug case)
  const candidates: string[] = [
    cleanText(obj?.simpleExplanation),
    cleanText(obj?.title),
    cleanText(obj?.raw),
    cleanText(obj?.text),
  ].filter(Boolean);

  for (const c of candidates) {
    const trimmed = c.trim();
    const jsonBlock = looksLikeJsonBlob(trimmed) ? trimmed : extractJsonBlock(trimmed);
    if (!jsonBlock) continue;

    const parsed = tryParseJson<any>(jsonBlock);
    if (parsed && typeof parsed === "object") {
      // Only accept if it has *some* meaningful content
      const hasEnough =
        typeof parsed.simpleExplanation === "string" &&
        parsed.simpleExplanation.trim().length > 30 &&
        (typeof parsed.realWorldExample === "string" ||
          Array.isArray(parsed.keyCommands) ||
          Array.isArray(parsed.commonMistakes) ||
          Array.isArray(parsed.quickCheck));

      if (!hasEnough) continue;

      const merged = { ...obj, ...parsed };
      const normalized = normalizeResult(
        {
          title: cleanText(merged.title),
          simpleExplanation: cleanText(merged.simpleExplanation),
          realWorldExample: cleanText(merged.realWorldExample),
          keyCommands: asStringArray(merged.keyCommands),
          commonMistakes: asStringArray(merged.commonMistakes),
          quickCheck: asStringArray(merged.quickCheck),
        },
        fallbackTitle
      );

      // IMPORTANT: ensure we didn't keep JSON as explanation by accident
      if (looksLikeJsonBlob(normalized.simpleExplanation)) {
        const p = tryParseJson<any>(normalized.simpleExplanation);
        if (p && typeof p === "object") return normalizeFromAny(p, fallbackTitle);
      }

      return normalized;
    }
  }

  // Normal structured response
  const normalized = normalizeResult(
    {
      title: cleanText(obj?.title) || fallbackTitle,
      simpleExplanation: cleanText(obj?.simpleExplanation),
      realWorldExample: cleanText(obj?.realWorldExample),
      keyCommands: asStringArray(obj?.keyCommands),
      commonMistakes: asStringArray(obj?.commonMistakes),
      quickCheck: asStringArray(obj?.quickCheck),
    },
    fallbackTitle
  );

  // If still empty and there is a big text field, parse it
  const bigText = cleanText(obj?.text || obj?.raw || "");
  if (
    (!normalized.simpleExplanation || normalized.simpleExplanation.length < 10) &&
    bigText.length > 30
  ) {
    return parseTextToSections(bigText, fallbackTitle);
  }

  return normalized;
}

/** ---------------------------
 *  Main exported function
 *  --------------------------- */
export async function explainConcept(concept: string, answerContext?: string): Promise<AiTutorResult> {
  // Instant return if cached
  const cached = getCached(concept, answerContext);
  if (cached) return cached;

  const prompt = `
You are a CCNA tutor. Be clear, natural, and practical.

CONCEPT: ${concept}

${answerContext ? `ANSWER CONTEXT:\n${answerContext}\n` : ""}

Return STRICT JSON ONLY with this exact shape:
{
  "title": "string",
  "simpleExplanation": "string",
  "realWorldExample": "string",
  "keyCommands": ["string"],
  "commonMistakes": ["string"],
  "quickCheck": ["string"]
}

Rules:
- Each string must be plain text (no markdown headings).
- keyCommands/commonMistakes/quickCheck must be arrays (empty array if none).
- quickCheck: 2–4 short Q&A bullets like "Q: ... A: ..."
`.trim();

  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model: "gemini-2.5-flash" }),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error || "Gemini API failed");
  }

  // Support BOTH server shapes:
  // 1) { ok:true, data:{...} }
  // 2) { text:"...", model:"..." }
  const candidate =
    (json && typeof json === "object" && "data" in json && json.data) ? json.data :
    (json && typeof json === "object" && typeof json.text === "string") ? json.text :
    json;

  const normalized = normalizeFromAny(candidate, concept);

  // Final safety: fill blanks so UI never looks broken
  const finalOut: AiTutorResult = {
    title: normalized.title || concept || "AI Tutor",
    simpleExplanation: normalized.simpleExplanation || "—",
    realWorldExample: normalized.realWorldExample || "—",
    keyCommands: normalized.keyCommands || [],
    commonMistakes: normalized.commonMistakes || [],
    quickCheck: normalized.quickCheck || [],
  };

  setCached(concept, answerContext, finalOut);
  return finalOut;
}
