// services/gemini.ts
export type AiTutorResult = {
  title: string;
  simpleExplanation: string;
  realWorldExample: string;
  keyCommands: string[];
  commonMistakes: string[];
  quickCheck: string[];
};

export async function explainConcept(concept: string, answerContext?: string) {
  const prompt = `
Explain this CCNA concept clearly with practical networking examples.

CONCEPT: ${concept}

${answerContext ? `ANSWER CONTEXT:\n${answerContext}\n` : ""}

Return a clear explanation, real-world example, key commands (if relevant), common mistakes, and quick check questions.
`.trim();

  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error || "Gemini API failed");
  }

  return data.result as AiTutorResult;
}
