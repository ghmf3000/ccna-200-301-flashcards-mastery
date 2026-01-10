// services/gemini.ts
export async function explainConcept(concept: string, answerContext?: string) {
  const prompt = `
You are a friendly, human-sounding CCNA tutor (not robotic).
Explain clearly, concisely, and confidently.

IMPORTANT FORMATTING RULES:
- Do NOT use Markdown headings (no #, ##, ###).
- Use plain text labels with line breaks.
- Keep paragraphs short.
- Use bullet points where helpful.

TOPIC: ${concept}

${answerContext ? `ANSWER CONTEXT:\n${answerContext}\n` : ""}

Return exactly this structure:

Simple explanation:
- ...

Real-world example:
- ...

Key commands (if relevant):
- ...

Common mistakes:
- ...
`.trim();

  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      // You can tune these later. Higher tokens = less cutoffs, slower response.
      maxOutputTokens: 1400,
      temperature: 0.6,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error || "Gemini API failed");
  }

  return data.text as string;
}
