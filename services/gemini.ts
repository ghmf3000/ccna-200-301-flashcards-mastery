// services/gemini.ts
export async function explainConcept(concept: string, answerContext?: string) {
  const prompt = `
You are a CCNA tutor.
Explain this concept clearly with practical networking examples.

CONCEPT: ${concept}

${answerContext ? `ANSWER CONTEXT:\n${answerContext}\n` : ""}

Return:
- Simple explanation
- Real-world example
- Key commands (if relevant)
- Common mistakes
`;

  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error || "Gemini API failed");
  }

  return data.text as string;
}
