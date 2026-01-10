import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  concept: string;
  explanation: string;
  loading: boolean;
  onClose: () => void;
};

const StudyAssistant: React.FC<Props> = ({ concept, explanation, loading, onClose }) => {
  return (
    <div className="aiOverlay" role="dialog" aria-modal="true">
      <div className="aiModal">
        <div className="aiHeader">
          <div className="aiTitleWrap">
            <div className="aiBadge">⚡</div>
            <div>
              <div className="aiTitle">AI Tutor</div>
              <div className="aiSubtitle">Deep dive: {concept}</div>
            </div>
          </div>
          <button className="aiClose" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="aiBody">
          {loading ? (
            <div className="aiSkeleton">
              <div className="aiShimmerLine w80" />
              <div className="aiShimmerLine w60" />
              <div className="aiShimmerLine w90" />
              <div className="aiShimmerLine w70" />
              <div className="aiShimmerLine w85" />
            </div>
          ) : (
            <div className="aiMarkdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {explanation || "No explanation returned."}
              </ReactMarkdown>
            </div>
          )}
        </div>

        <div className="aiFooter">
          <button className="aiOk" onClick={onClose}>
            Got it, thanks!
          </button>
        </div>
      </div>
    </div>
  );
};

export default StudyAssistant;
