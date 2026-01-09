export async function explainConcept(concept: string, answerContext?: string) {
  const prompt = `
You are a CCNA tutor.
Explain clearly with practical networking examples.

CONCEPT: ${concept}

${answerContext ? `ANSWER CONTEXT:\n${answerContext}\n` : ""}

Return:
### Simple explanation
### Real-world example
### Key commands (if relevant)
### Common mistakes
`.trim();

  const cacheKey = `ccna_ai_${btoa(unescape(encodeURIComponent(prompt))).slice(0, 200)}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error || "Gemini API failed");
  }

  const text = data.text as string;
  localStorage.setItem(cacheKey, text);
  return text;
}
