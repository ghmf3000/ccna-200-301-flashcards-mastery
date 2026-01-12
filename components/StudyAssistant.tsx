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

type SectionTone =
  | "default"
  | "commands"
  | "mistakes"
  | "check"
  | "example";

const toneStyles: Record<SectionTone, string> = {
  default: "from-blue-500 to-indigo-500",
  commands: "from-green-500 to-emerald-500",
  mistakes: "from-red-500 to-rose-500",
  check: "from-purple-500 to-fuchsia-500",
  example: "from-orange-500 to-amber-500",
};

const toneIcon: Record<SectionTone, string> = {
  default: "💡",
  example: "🌍",
  commands: "⌨️",
  mistakes: "⚠️",
  check: "✅",
};

const Section: React.FC<{
  title: string;
  tone?: SectionTone;
  children: React.ReactNode;

  collapsible?: boolean;
  defaultOpen?: boolean;
}> = ({
  title,
  tone = "default",
  children,
  collapsible = true,
  defaultOpen = false,
}) => {
  const Header = (
    <div className="flex items-center gap-2">
      <div className={`w-1.5 h-5 rounded-full bg-gradient-to-b ${toneStyles[tone]}`} />
      <span className="text-base leading-none">{toneIcon[tone]}</span>
      <span className="text-xs font-extrabold uppercase tracking-widest text-slate-700">
        {title}
      </span>
    </div>
  );

  // Non-collapsible
  if (!collapsible) {
    return (
      <div className="border border-slate-200 rounded-2xl p-4 bg-white shadow-sm">
        <div className="mb-3">{Header}</div>
        {children}
      </div>
    );
  }

  // Collapsible (chevron rotation handled by Tailwind group-open)
  return (
    <details
      className="group border border-slate-200 rounded-2xl bg-white shadow-sm"
      open={defaultOpen}
    >
      <summary className="cursor-pointer select-none list-none p-4 flex items-center justify-between">
        {Header}
        <span className="text-slate-400 font-black text-lg leading-none transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>

      <div className="px-4 pb-4 -mt-1">{children}</div>
    </details>
  );
};
}

  // Collapsible card
  return (
    <details
      className="border border-slate-200 rounded-2xl bg-white shadow-sm animate-in"
      style={{ animationDelay: `${delay}ms` }}
      open={defaultOpen}
    >
      <summary className="cursor-pointer select-none list-none p-4 flex items-center justify-between">
        {Header}
        <span className="text-slate-400 font-black text-lg leading-none">›</span>
      </summary>

      <div className="px-4 pb-4 -mt-1">{children}</div>
    </details>
  );
};

const Bullets: React.FC<{ items: string[] }> = ({ items }) => {
  if (!items?.length) return <p className="text-sm text-slate-500">—</p>;
  return (
    <ul className="list-disc pl-5 space-y-1 text-sm text-slate-800">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
};

// ---------- Robust normalizers (fix the “raw JSON blob” problem) ----------
function extractJsonBlock(s: string): string | null {
  if (!s) return null;
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return s.slice(first, last + 1);
}

function tryParseJson(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function looksLikeJsonBlob(s: string) {
  if (!s) return false;
  const t = s.trim();
  return t.startsWith("{") && t.includes('"simpleExplanation"') && t.includes('"title"');
}

function cleanText(s?: string) {
  if (!s) return "";
  let t = String(s);

  // remove code fences if any
  t = t.replace(/```(?:json)?/gi, "").replace(/```/g, "");

  // trim
  t = t.trim();

  // remove “hashtag headers” that break your UI (### etc.)
  t = t
    .split("\n")
    .filter((line) => !/^\s*#+\s*/.test(line)) // lines starting with ###, ##
    .join("\n")
    .trim();

  return t;
}

function toStringArray(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => cleanText(String(x))).filter(Boolean);

  // If a single string was returned, split on new lines / bullets
  const s = cleanText(String(v));
  if (!s) return [];

  return s
    .split(/\n|•|·|\u2022|-\s+/g)
    .map((x) => cleanText(x))
    .filter(Boolean);
}

function normalizeResult(input: AiTutorResult | null): AiTutorResult | null {
  if (!input) return null;

  const candidates = [
    (input as any)?.simpleExplanation,
    (input as any)?.title,
    (input as any)?.raw,
    (input as any)?.text,
  ]
    .map((x) => (typeof x === "string" ? x : ""))
    .filter(Boolean);

  const safeTextFallback = (s: any) => {
    const t = cleanText(typeof s === "string" ? s : "");
    return looksLikeJsonBlob(t) ? "" : t;
  };

  for (const c of candidates) {
    const trimmed = c.trim();
    const jsonBlock = looksLikeJsonBlob(trimmed) ? trimmed : extractJsonBlock(trimmed);
    if (!jsonBlock) continue;

    const parsed = tryParseJson(jsonBlock);
    if (parsed && typeof parsed === "object") {
      // Use parsed JSON EVEN IF it's short (prevents raw blob leaking into UI)
      const out: any = {};

      out.title = cleanText(parsed.title) || safeTextFallback((input as any)?.title) || "AI Tutor";
      out.simpleExplanation = cleanText(parsed.simpleExplanation) || safeTextFallback((input as any)?.simpleExplanation);
      out.realWorldExample = cleanText(parsed.realWorldExample) || safeTextFallback((input as any)?.realWorldExample);

      out.keyCommands = toStringArray(parsed.keyCommands);
      out.commonMistakes = toStringArray(parsed.commonMistakes);
      out.quickCheck = toStringArray(parsed.quickCheck);

      return out as AiTutorResult;
    }
  }

  // Normal path: clean/normalize without JSON
  const out: any = {};
  out.title = safeTextFallback((input as any)?.title) || "AI Tutor";
  out.simpleExplanation = safeTextFallback((input as any)?.simpleExplanation);
  out.realWorldExample = safeTextFallback((input as any)?.realWorldExample);
  out.keyCommands = toStringArray((input as any)?.keyCommands);
  out.commonMistakes = toStringArray((input as any)?.commonMistakes);
  out.quickCheck = toStringArray((input as any)?.quickCheck);

  return out as AiTutorResult;
}
// ----------------------------------------------------------------------

export default function StudyAssistant({ concept, result, loading, onClose }: Props) {
  const normalized = useMemo(() => normalizeResult(result), [result]);

  // Build one “streaming” block (instant feel)
  const streamText = useMemo(() => {
    if (!normalized) return "";
    const parts = [
      normalized.simpleExplanation?.trim(),
      normalized.realWorldExample?.trim() ? `Example: ${normalized.realWorldExample.trim()}` : "",
      normalized.keyCommands?.length ? `Commands: ${normalized.keyCommands.join(" • ")}` : "",
    ].filter(Boolean);
    return parts.join("\n\n");
  }, [normalized]);

  // Only typewriter when we have real text (and not accidentally a JSON blob)
  const typewriterEnabled = !!streamText && !loading && streamText.length > 10 && !looksLikeJsonBlob(streamText);
  const typed = useTypewriter(streamText, typewriterEnabled, 10);

  const missing = (s?: string) => !s || !s.trim();

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <button aria-label="Close AI Tutor" onClick={onClose} className="absolute inset-0 bg-black/40" />

      {/* Modal */}
      <div className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="p-5 flex items-start justify-between border-b border-slate-200">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center">⚡</div>
            <div>
              <div className="text-sm font-black text-slate-900">AI Tutor</div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                Deep Dive: {concept}
              </div>
            </div>
          </div>

          <button onClick={onClose} className="w-10 h-10 rounded-full hover:bg-slate-100 text-slate-500 font-black">
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

          {!loading && normalized && (
            <>
              {/* Typewriter preview */}
              {!!streamText && (
                <div className="whitespace-pre-wrap text-sm text-slate-800 bg-white border border-slate-200 rounded-2xl p-4">
                  {typed}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <Section title="Simple explanation" tone="default" defaultOpen index={0}>
                 <p className="text-sm text-slate-800 whitespace-pre-wrap">
                    {normalized.simpleExplanation || "—"}
                 </p>
               </Section>

                <Section title="Real-world example" tone="example" defaultOpen index={1}>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">
                    {normalized.realWorldExample || "—"}
                  </p>
                </Section>

                <Section title="Key commands" tone="commands" index={2}>
                  <Bullets items={normalized.keyCommands || []} />
                </Section>

                <Section title="Common mistakes" tone="mistakes" index={3}>
                  <Bullets items={normalized.commonMistakes || []} />
                </Section>

                <div className="md:col-span-2">
                  <Section title="Quick check" tone="check" index={4}>
                    <Bullets items={normalized.quickCheck || []} />
                  </Section>
                </div>
              </div>
            </>
          )}

          {!loading && !normalized && (
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
