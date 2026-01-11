// components/StudyAssistant.tsx
import React, { useEffect, useMemo, useState } from "react";
import type { AiTutorResult } from "../services/gemini";

type Props = {
  concept: string;
  result: AiTutorResult | null;
  loading: boolean;
  onClose: () => void;
};

function useTypewriter(text: string, enabled: boolean, speedMs = 12) {
  const [out, setOut] = useState("");

  useEffect(() => {
    if (!enabled) {
      setOut(text);
      return;
    }
    setOut("");
    if (!text) return;

    // word-by-word
    const words = text.split(/\s+/);
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setOut(words.slice(0, i).join(" "));
      if (i >= words.length) clearInterval(timer);
    }, speedMs);

    return () => clearInterval(timer);
  }, [text, enabled, speedMs]);

  return out;
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50">
    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
      {title}
    </div>
    {children}
  </div>
);

const Bullets: React.FC<{ items: string[] }> = ({ items }) => {
  if (!items?.length) return <p className="text-sm text-slate-500">—</p>;
  return (
    <ul className="list-disc pl-5 space-y-1 text-sm text-slate-800">
      {items.map((x, i) => <li key={i}>{x}</li>)}
    </ul>
  );
};

export default function StudyAssistant({ concept, result, loading, onClose }: Props) {
  // Build one “streaming” block (so it feels instant like ChatGPT)
  const streamText = useMemo(() => {
    if (!result) return "";
    const parts = [
      result.simpleExplanation?.trim(),
      result.realWorldExample?.trim() ? `Example: ${result.realWorldExample.trim()}` : "",
      (result.keyCommands?.length ? `Commands: ${result.keyCommands.join(" • ")}` : ""),
    ].filter(Boolean);
    return parts.join("\n\n");
  }, [result]);

  const typed = useTypewriter(streamText, true, 10);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        aria-label="Close AI Tutor"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      {/* Modal */}
      <div className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="p-5 flex items-start justify-between border-b border-slate-200">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center">
              ⚡
            </div>
            <div>
              <div className="text-sm font-black text-slate-900">AI Tutor</div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                Deep Dive: {concept}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full hover:bg-slate-100 text-slate-500 font-black"
          >
            ×
          </button>
        </div>

        <div className="p-5 max-h-[70vh] overflow-y-auto space-y-4">
          {loading && (
            <div className="flex items-center gap-3 text-slate-500">
              <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
              <div className="text-sm font-bold">Thinking...</div>
            </div>
          )}

          {!loading && result && (
            <>
              {/* Typewriter preview (feels instant) */}
              <div className="whitespace-pre-wrap text-sm text-slate-800 bg-white border border-slate-200 rounded-2xl p-4">
                {typed}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Section title="Simple explanation">
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">
                    {result.simpleExplanation || "—"}
                  </p>
                </Section>

                <Section title="Real-world example">
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">
                    {result.realWorldExample || "—"}
                  </p>
                </Section>

                <Section title="Key commands">
                  <Bullets items={result.keyCommands || []} />
                </Section>

                <Section title="Common mistakes">
                  <Bullets items={result.commonMistakes || []} />
                </Section>

                <div className="md:col-span-2">
                  <Section title="Quick check">
                    <Bullets items={result.quickCheck || []} />
                  </Section>
                </div>
              </div>
            </>
          )}

          {!loading && !result && (
            <p className="text-sm text-slate-600">
              No explanation yet. Click <b>AI Explain</b> again.
            </p>
          )}
        </div>

        <div className="p-5 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-black shadow-lg hover:bg-slate-800"
          >
            Got it, thanks!
          </button>
        </div>
      </div>
    </div>
  );
}
