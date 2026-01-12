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

  /** Collapsible behavior */
  collapsible?: boolean;
  defaultOpen?: boolean;

  /** Animation */
  index?: number;
}> = ({
  title,
  tone = "default",
  children,
  collapsible = true,
  defaultOpen = false,
  index = 0,
}) => {
  const delay = Math.min(index * 60, 240); // stagger up to ~0.24s max

  const Header = (
    <div className="flex items-center gap-2">
      <div
        className={`w-1.5 h-5 rounded-full bg-gradient-to-b ${toneStyles[tone]}`}
      />
      <span className="text-base leading-none">{toneIcon[tone]}</span>
      <span className="text-xs font-extrabold uppercase tracking-widest text-slate-700">
        {title}
      </span>
    </div>
  );

  // If not collapsible, render like a normal card
  if (!collapsible) {
    return (
      <div
        className="border border-slate-200 rounded-2xl p-4 bg-white shadow-sm animate-in"
        style={{ animationDelay: `${delay}ms` }}
      >
        <div className="mb-3">{Header}</div>
        {children}
      </div>
    );
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

  // Sometimes the whole JSON ends up inside simpleExplanation or title, etc.
  const candidates = [
    (input as any)?.simpleExplanation,
    (input as any)?.title,
    (input as any)?.raw,
    (input as any)?.text,
  ]
    .map((x) => (typeof x === "string" ? x : ""))
    .filter(Boolean);

  for (const c of candidates) {
    const trimmed = c.trim();
    const jsonBlock = looksLikeJsonBlob(trimmed) ? trimmed : extractJsonBlock(trimmed);
    if (!jsonBlock) continue;

    const parsed = tryParseJson(jsonBlock);
    if (parsed && typeof parsed === "object") {
  // If core fields are missing, ignore this JSON blob
  const hasEnoughData =
  typeof parsed.simpleExplanation === "string" &&
  parsed.simpleExplanation.length > 40 &&
  (
    typeof parsed.realWorldExample === "string" ||
    Array.isArray(parsed.keyCommands) ||
    Array.isArray(parsed.commonMistakes)
  );

   if (!hasEnoughData) continue;

  const merged: any = { ...(input as any), ...parsed };

// normalize fields
merged.title = cleanText(merged.title) || "AI Tutor";
merged.simpleExplanation = cleanText(merged.simpleExplanation);
merged.realWorldExample = cleanText(merged.realWorldExample);
merged.keyCommands = normalizeList(merged.keyCommands);
merged.commonMistakes = normalizeList(merged.commonMistakes);
merged.quickCheck = normalizeList(merged.quickCheck);

// ✅ stop once we have a valid fixed object
return merged as AiTutorResult;
    }
  }

  // Normal path: just clean/normalize
  const out: any = { ...(input as any) };
  out.title = cleanText(out.title) || "AI Tutor";
  out.simpleExplanation = cleanText(out.simpleExplanation);
  out.realWorldExample = cleanText(out.realWorldExample);
  out.keyCommands = toStringArray(out.keyCommands);
  out.commonMistakes = toStringArray(out.commonMistakes);
  out.quickCheck = toStringArray(out.quickCheck);
  return out as AiTutorResult;
}
// ----------------------------------------------------------------------
const styles = `
@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
.animate-in {
  opacity: 0;
  animation: fadeSlideIn 260ms ease-out forwards;
}

/* rotate the chevron when open */
details[open] summary span:last-child {
  transform: rotate(90deg);
  transition: transform 150ms ease;
}
details summary span:last-child {
  transition: transform 150ms ease;
}
`;

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
                <Section title="Simple explanation" tone="default">
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">
                    {missing(normalized.simpleExplanation) ? "—" : normalized.simpleExplanation}
                  </p>
                </Section>

                <Section title="Real-world example" tone="example">
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">
                    {missing(normalized.realWorldExample) ? "—" : normalized.realWorldExample}
                  </p>
                </Section>

                <Section title="Key commands" tone="commands">
                  <Bullets items={normalized.keyCommands || []} />
                </Section>

                <Section title="Common mistakes" tone="mistakes">
                  <Bullets items={normalized.commonMistakes || []} />
                </Section>

                <div className="md:col-span-2">
                  <Section title="Quick check" tone="check">
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
