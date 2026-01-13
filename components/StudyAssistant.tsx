// components/StudyAssistant.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AiTutorResult } from "../services/gemini";

type Props = {
  concept: string;
  result: AiTutorResult | null;
  loading: boolean;
  onClose: () => void;
};

/* -------------------- TTS (per-section, stop-toggle) -------------------- */
function useSectionTTS() {
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const stop = () => {
    try {
      window.speechSynthesis.cancel();
    } catch {}
    utterRef.current = null;
    setSpeakingId(null);
  };

  const speak = (id: string, text: string) => {
    const t = (text || "").trim();
    if (!t) return;

    // Toggle: if same section, stop.
    if (speakingId === id) {
      stop();
      return;
    }

    // Stop any existing speech then speak the new one
    stop();

    try {
      const utter = new SpeechSynthesisUtterance(t);
      utterRef.current = utter;

      utter.rate = 1;
      utter.pitch = 1;

      utter.onstart = () => setSpeakingId(id);
      utter.onend = () => setSpeakingId(null);
      utter.onerror = () => setSpeakingId(null);

      window.speechSynthesis.speak(utter);
    } catch {
      setSpeakingId(null);
    }
  };

  useEffect(() => {
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { speak, stop, speakingId };
}

/* -------------------- Normalizers (avoid JSON blob issues) -------------------- */
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
  t = t.trim();

  // remove markdown headers like ### that can appear in responses
  t = t
    .split("\n")
    .filter((line) => !/^\s*#+\s*/.test(line))
    .join("\n")
    .trim();

  return t;
}

function toStringArray(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => cleanText(String(x))).filter(Boolean);

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
      const hasEnoughData =
        typeof parsed.simpleExplanation === "string" &&
        parsed.simpleExplanation.length > 20 &&
        (typeof parsed.realWorldExample === "string" ||
          Array.isArray(parsed.keyCommands) ||
          Array.isArray(parsed.commonMistakes));

      if (!hasEnoughData) continue;

      const merged: any = { ...(input as any), ...parsed };

      merged.title = cleanText(merged.title) || "AI Tutor";
      merged.simpleExplanation = cleanText(merged.simpleExplanation);
      merged.realWorldExample = cleanText(merged.realWorldExample);
      merged.keyCommands = toStringArray(merged.keyCommands);
      merged.commonMistakes = toStringArray(merged.commonMistakes);
      merged.quickCheck = toStringArray(merged.quickCheck);

      return merged as AiTutorResult;
    }
  }

  // Normal path
  const out: any = { ...(input as any) };
  out.title = cleanText(out.title) || "AI Tutor";
  out.simpleExplanation = cleanText(out.simpleExplanation);
  out.realWorldExample = cleanText(out.realWorldExample);
  out.keyCommands = toStringArray(out.keyCommands);
  out.commonMistakes = toStringArray(out.commonMistakes);
  out.quickCheck = toStringArray(out.quickCheck);
  return out as AiTutorResult;
}

/* -------------------- UI helpers -------------------- */
type SectionTone = "default" | "commands" | "mistakes" | "check" | "example";

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

const SpeakButton: React.FC<{
  id: string;
  text: string;
  tone: SectionTone;
  speakingId: string | null;
  onSpeak: (id: string, text: string) => void;
}> = ({ id, text, tone, speakingId, onSpeak }) => {
  const isOn = speakingId === id;
  return (
    <button
      type="button"
      onClick={(e) => {
        // important: don't toggle collapse when clicking speaker
        e.preventDefault();
        e.stopPropagation();
        onSpeak(id, text);
      }}
      className="text-[11px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
      title={isOn ? "Stop" : "Listen"}
    >
      {isOn ? "⏹ Stop" : "🔊 Listen"}
    </button>
  );
};

const Section: React.FC<{
  title: string;
  tone?: SectionTone;
  children: React.ReactNode;

  collapsible?: boolean;
  defaultOpen?: boolean;

  speakId?: string;
  speakText?: string;

  speakingId: string | null;
  onSpeak: (id: string, text: string) => void;
}> = ({
  title,
  tone = "default",
  children,
  collapsible = true,
  defaultOpen = false,
  speakId,
  speakText,
  speakingId,
  onSpeak,
}) => {
  const Header = (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <div className={`w-1.5 h-5 rounded-full bg-gradient-to-b ${toneStyles[tone]}`} />
        <span className="text-base leading-none">{toneIcon[tone]}</span>
        <span className="text-xs font-extrabold uppercase tracking-widest text-slate-800">
          {title}
        </span>
      </div>

      {speakId && speakText ? (
        <SpeakButton
          id={speakId}
          text={speakText}
          tone={tone}
          speakingId={speakingId}
          onSpeak={onSpeak}
        />
      ) : null}
    </div>
  );

  if (!collapsible) {
    return (
      <div className="border border-slate-200 rounded-2xl p-4 bg-white shadow-sm">
        <div className="mb-3">{Header}</div>
        {children}
      </div>
    );
  }

  return (
    <details
      className="border border-slate-200 rounded-2xl bg-white shadow-sm"
      open={defaultOpen}
    >
      <summary className="cursor-pointer select-none list-none p-4 flex items-center justify-between">
        <div className="w-full">{Header}</div>
        <span className="text-slate-400 font-black text-lg leading-none ml-3">›</span>
      </summary>

      <div className="px-4 pb-4 -mt-1">{children}</div>
    </details>
  );
};

/* -------------------- Component -------------------- */
export default function StudyAssistant({ concept, result, loading, onClose }: Props) {
  const normalized = useMemo(() => normalizeResult(result), [result]);

  const { speak, stop, speakingId } = useSectionTTS();

  // stop TTS when modal closes
  useEffect(() => {
    if (loading) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const safe = normalized ?? {
    title: "AI Tutor",
    simpleExplanation: "",
    realWorldExample: "",
    keyCommands: [],
    commonMistakes: [],
    quickCheck: [],
  };

  // Prepare speak text per section
  const speakSimple = safe.simpleExplanation || "";
  const speakExample = safe.realWorldExample || "";
  const speakCommands = (safe.keyCommands || []).join(". ");
  const speakMistakes = (safe.commonMistakes || []).join(". ");
  const speakCheck = (safe.quickCheck || []).join(". ");

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        aria-label="Close AI Tutor"
        onClick={() => {
          stop();
          onClose();
        }}
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
            onClick={() => {
              stop();
              onClose();
            }}
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

          {!loading && normalized && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Section
                title="Simple explanation"
                tone="default"
                defaultOpen
                speakId="simple"
                speakText={speakSimple}
                speakingId={speakingId}
                onSpeak={speak}
              >
                <p className="text-sm text-slate-800 whitespace-pre-wrap">
                  {safe.simpleExplanation || "—"}
                </p>
              </Section>

              <Section
                title="Real-world example"
                tone="example"
                defaultOpen
                speakId="example"
                speakText={speakExample}
                speakingId={speakingId}
                onSpeak={speak}
              >
                <p className="text-sm text-slate-800 whitespace-pre-wrap">
                  {safe.realWorldExample || "—"}
                </p>
              </Section>

              <Section
                title="Key commands"
                tone="commands"
                speakId="commands"
                speakText={speakCommands}
                speakingId={speakingId}
                onSpeak={speak}
              >
                <Bullets items={safe.keyCommands || []} />
              </Section>

              <Section
                title="Common mistakes"
                tone="mistakes"
                speakId="mistakes"
                speakText={speakMistakes}
                speakingId={speakingId}
                onSpeak={speak}
              >
                <Bullets items={safe.commonMistakes || []} />
              </Section>

              <div className="md:col-span-2">
                <Section
                  title="Quick check"
                  tone="check"
                  speakId="check"
                  speakText={speakCheck}
                  speakingId={speakingId}
                  onSpeak={speak}
                >
                  <Bullets items={safe.quickCheck || []} />
                </Section>
              </div>
            </div>
          )}

          {!loading && !normalized && (
            <p className="text-sm text-slate-600">
              No explanation yet. Click <b>AI Explain</b> again.
            </p>
          )}
        </div>

        <div className="p-5 border-t border-slate-200 flex justify-end">
          <button
            onClick={() => {
              stop();
              onClose();
            }}
            className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-black shadow-lg hover:bg-slate-800"
          >
            Got it, thanks!
          </button>
        </div>
      </div>
    </div>
  );
}
