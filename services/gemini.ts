export async function explainConcept(concept: string, answerContext?: string) {
  // Keep context from exploding your prompt (which increases latency + cutoffs)
  const ctx = (answerContext || "").trim();
  const shortCtx = ctx.length > 800 ? ctx.slice(0, 800) + "\n...(trimmed)" : ctx;

  const prompt = `
You are a CCNA tutor.
Explain clearly with practical networking examples.

IMPORTANT OUTPUT RULES:
- Use plain text and short sections.
- Do NOT use hashtags (#). Use section titles like "Simple explanation:".
- Keep it complete (no abrupt ending).

Concept: ${concept}

${shortCtx ? `Answer context:\n${shortCtx}\n` : ""}

Return exactly these sections:
Simple explanation:
Real-world example:
Key commands (if relevant):
Common mistakes:
`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        // You can also set GEMINI_MODEL in Vercel env vars.
        // model: "gemini-2.5-flash",
      }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data?.error || `Gemini API failed (${res.status})`);
    }

    return (data.text as string) || "No explanation returned.";
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("AI Tutor timed out. Try again (or reduce the concept text).");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
