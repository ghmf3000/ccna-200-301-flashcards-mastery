// services/gemini.ts

const cache = new Map<string, string>();

function cacheKey(prompt: string) {
  return prompt.trim().slice(0, 5000); // enough uniqueness without huge keys
}

async function postGemini(prompt: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

  try {
    const res = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.error || "Gemini API failed");
    }

    return (data.text as string) || "";
  } finally {
    clearTimeout(timeout);
  }
}

export async function explainConcept(concept: string, answerContext?: string) {
  // Keep prompt shorter (faster) but structured
  const prompt = `You are a friendly CCNA tutor.
Explain clearly and concisely, with one practical example.

Concept: ${concept}
${answerContext ? `Answer context: ${answerContext}` : ""}

Return EXACTLY in this format:
1) Simple explanation (2-4 sentences)
2) Real-world example (2-4 sentences)
3) Key commands (bullets, if any)
4) Common mistakes (bullets)
`;

  const key = cacheKey(prompt);
  const cached = cache.get(key);
  if (cached) return cached;

  // Try once, then retry one time if it fails
  try {
    const text = await postGemini(prompt);
    cache.set(key, text);
    return text;
  } catch (e) {
    // retry once
    const text = await postGemini(prompt);
    cache.set(key, text);
    return text;
  }
}
