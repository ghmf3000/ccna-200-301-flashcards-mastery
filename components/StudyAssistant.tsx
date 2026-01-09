import React, { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

type Props = {
  concept: string;
  explanation: string;
  loading: boolean;
  onClose: () => void;
};

function wrapHashtags(html: string) {
  // Wrap hashtags like #OSPF, #CCNA-Tips (not headings)
  return html.replace(/(^|\s)(#[\w-]+)/g, '$1<span class="ai-hashtag">$2</span>');
}

export default function StudyAssistant({ concept, explanation, loading, onClose }: Props) {
  const html = useMemo(() => {
    const raw = marked.parse(explanation || "");
    const safe = DOMPurify.sanitize(String(raw));
    return wrapHashtags(safe);
  }, [explanation]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <div className="text-sm font-black text-slate-800">AI Tutor</div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
              Deep Dive: {concept}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl">×</button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-3/4" />
              <div className="h-4 bg-slate-200 rounded w-full" />
              <div className="h-4 bg-slate-200 rounded w-11/12" />
              <div className="h-4 bg-slate-200 rounded w-2/3" />
            </div>
          ) : (
            <div
              className="ai-explanation prose prose-slate max-w-none"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>

        <div className="px-6 py-4 border-t flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800"
          >
            Got it, thanks!
          </button>
        </div>
      </div>
    </div>
  );
}
