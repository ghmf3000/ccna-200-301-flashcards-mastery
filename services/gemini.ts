// services/gemini.ts
export type TutorJSON = {
  title: string;
  simpleExplanation: string;
  realWorldExample: string;
  keyCommands: string[];
  commonMistakes: string[];
  quickCheck: string[];
};

export async function explainConcept(concept: string, answerContext?: string) {
  const prompt = `
Explain this concept clearly with practical networking examples.

CONCEPT: ${concept}

${answerContext ? `ANSWER CONTEXT:\n${answerContext}\n` : ""}

Return:
- Simple explanation
- Real-world example
- Key commands (if relevant)
- Common mistakes
- Quick check (2-4 Q&A style bullets)
`.trim();

  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json?.error || "Gemini API failed");
  }

  // New server shape: { ok:true, data:{...} }
  return (json.data as TutorJSON);
}
