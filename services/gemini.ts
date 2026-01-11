// services/gemini.ts

export type TutorSections = {
  title?: string;
  simpleExplanation?: string;
  realWorldExample?: string;
  keyCommands?: string[];
  commonMistakes?: string[];
  quickCheck?: string[];
};

function buildTutorPrompt(concept: string, answerContext?: string) {
  return `
You are a CCNA tutor. Write in a friendly, human tone (not robotic).
Return STRICT JSON ONLY (no markdown, no backticks).

Schema:
{
  "title": string,
  "simpleExplanation": string,
  "realWorldExample": string,
  "keyCommands": string[],
  "commonMistakes": string[],
  "quickCheck": string[]
}

Rules:
- Keep it complete but not overly long.
- If key commands not relevant, return [].
- quickCheck should be 2-4 bullet items a learner can self-test.

CONCEPT: ${concept}

${answerContext ? `ANSWER CONTEXT:\n${answerContext}\n` : ""}

JSON:
`.trim();
}

// Parse JSON safely; if model returns plain text, wrap it.
function safeParseTutorJSON(text: string): TutorSections {
  try {
    const obj = JSON.parse(text);
    // normalize arrays
    return {
      title: obj.title ?? "",
      simpleExplanation: obj.simpleExplanation ?? "",
      realWorldExample: obj.realWorldExample ?? "",
      keyCommands: Array.isArray(obj.keyCommands) ? obj.keyCommands : [],
      commonMistakes: Array.isArray(obj.commonMistakes) ? obj.commonMistakes : [],
      quickCheck: Array.isArray(obj.quickCheck) ? obj.quickCheck : [],
    };
  } catch {
    return {
      title: "AI Tutor",
      simpleExplanation: text,
      realWorldExample: "",
      keyCommands: [],
      commonMistakes: [],
      quickCheck: [],
    };
  }
}

// ---- STREAMING: reads SSE from /api/gemini ----
export async function explainConceptStream(opts: {
  concept: string;
  answerContext?: string;
  onToken: (deltaText: string) => void;  // called as text arrives
  onDone: (finalText: string) => void;
  onError: (message: string) => void;
}) {
  const prompt = buildTutorPrompt(opts.concept, opts.answerContext);

  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
    body: JSON.stringify({ prompt, stream: true }),
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    opts.onError(data?.error || `Gemini failed (${res.status})`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let buffer = "";
  let full = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Our server emits SSE with "\n\n" separators
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const ev of events) {
        const lines = ev.split("\n").map((l) => l.trim());
        const eventLine = lines.find((l) => l.startsWith("event:"));
        const dataLine = lines.find((l) => l.startsWith("data:"));
        if (!dataLine) continue;

        const payloadStr = dataLine.replace(/^data:\s*/, "");
        let payload: any = null;
        try { payload = JSON.parse(payloadStr); } catch { payload = null; }

        const eventName = eventLine?.replace(/^event:\s*/, "") || "";

        if (eventName === "chunk" && payload?.delta) {
          full += payload.delta;
          opts.onToken(payload.delta);
        }

        if (eventName === "done") {
          opts.onDone(full);
          return;
        }
      }
    }

    opts.onDone(full);
  } catch (e: any) {
    opts.onError(e?.message || "Streaming error");
  }
}

// Non-stream version (fallback)
export async function explainConcept(concept: string, answerContext?: string): Promise<TutorSections> {
  const prompt = buildTutorPrompt(concept, answerContext);

  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Gemini API failed");
  return safeParseTutorJSON(data.text || "");
}

// Helper you can use after streaming finishes
export function parseTutorSectionsFromText(fullText: string): TutorSections {
  return safeParseTutorJSON(fullText);
}
