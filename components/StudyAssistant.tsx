// components/StudyAssistant.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { parseTutorSectionsFromText, TutorSections } from "../services/gemini";

type Props = {
  concept: string;
  explanation: string; // you can keep passing this; we handle both
  loading: boolean;
  onClose: () => void;
};

function splitWordsKeepingSpaces(text: string) {
  // Keeps spaces so typing looks natural
  return text.split(/(\s+)/);
}

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
    <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">
      {title}
    </div>
    <div className="text-slate-800 leading-relaxed text-sm">{children}</div>
  </div>
);

export default function StudyAssistant({ concept, explanation, loading, onClose }: Props) {
  // We support both “full text” or JSON-like content
  const [sections, setSections] = useState<TutorSections | null>(null);

  // Typing effect state
  const [typedText, setTypedText] = useState("");
  const typingQueueRef = useRef<string[]>([]);
  const typingTimerRef = useRef<number | null>(null);

  const fullText = (explanation || "").trim();

  // If explanation changes (from streaming updates), update typing queue
  useEffect(() => {
    // If the explanation is JSON-ish, we’ll parse at end;
    // While streaming, we show typedText.
    // Here we only “type” the raw incoming text.
    if (!fullText) return;

    // Reset typing if concept changed significantly
    setTypedText("");

    const tokens = splitWordsKeepingSpaces(fullText);
    typingQueueRef.current = tokens;

    if (typingTimerRef.current) window.clearInterval(typingTimerRef.current);

    typingTimerRef.current = window.setInterval(() => {
      const q = typingQueueRef.current;
      if (q.length === 0) {
        if (typingTimerRef.current) window.clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;

        // Once typing done, parse to sections (cards)
        const parsed = parseTutorSectionsFromText(fullText);
        setSections(parsed);
        return;
      }

      // Pull 1–3 tokens per tick for speed
      const chunk = q.splice(0, 3).join("");
      setTypedText((prev) => prev + chunk);
    }, 20);

    return () => {
      if (typingTimerRef.current) window.clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    };
  }, [concept, fullText]);

  const showCards = useMemo(() => {
    if (!sections) return false;

    const hasAny =
      (sections.simpleExplanation && sections.simpleExplanation.trim()) ||
      (sections.realWorldExample && sections.realWorldExample.trim()) ||
      (sections.keyCommands && sections.keyCommands.length) ||
      (sections.commonMistakes && sections.commonMistakes.length) ||
      (sections.quickCheck && sections.quickCheck.length);

    return Boolean(hasAny);
  }, [sections]);

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 font-black">
                ⚡
              </div>
              <div>
                <div className="text-sm font-black text-slate-800">AI Tutor</div>
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                  Deep dive: {concept}
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 font-black text-lg px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 max-h-[70vh] overflow-y-auto">
          {loading && !fullText && (
            <div className="flex items-center gap-3 text-slate-500">
              <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin"></div>
              <div className="text-sm font-semibold">Thinking…</div>
            </div>
          )}

          {/* While streaming / typing */}
          {!showCards && typedText && (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
              {typedText}
              <span className="inline-block w-2 animate-pulse">▍</span>
            </div>
          )}

          {/* After parse: structured cards */}
          {showCards && sections && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card title="Simple explanation">
                {sections.simpleExplanation || "—"}
              </Card>

              <Card title="Real-world example">
                {sections.realWorldExample || "—"}
              </Card>

              <Card title="Key commands">
                {sections.keyCommands?.length ? (
                  <ul className="list-disc pl-5 space-y-1">
                    {sections.keyCommands.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                ) : (
                  "—"
                )}
              </Card>

              <Card title="Common mistakes">
                {sections.commonMistakes?.length ? (
                  <ul className="list-disc pl-5 space-y-1">
                    {sections.commonMistakes.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                ) : (
                  "—"
                )}
              </Card>

              <div className="md:col-span-2">
                <Card title="Quick check">
                  {sections.quickCheck?.length ? (
                    <ul className="list-disc pl-5 space-y-1">
                      {sections.quickCheck.map((x, i) => <li key={i}>{x}</li>)}
                    </ul>
                  ) : (
                    "—"
                  )}
                </Card>
              </div>
            </div>
          )}

          {!loading && !fullText && (
            <div className="text-slate-500 text-sm">No explanation available.</div>
          )}
        </div>

        <div className="p-5 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-3 rounded-2xl bg-slate-900 text-white font-black shadow-lg hover:bg-slate-800 transition"
          >
            Got it, thanks!
          </button>
        </div>
      </div>
    </div>
  );
}
