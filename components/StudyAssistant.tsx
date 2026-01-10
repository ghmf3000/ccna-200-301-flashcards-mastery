import React, { useEffect } from "react";

type Props = {
  concept: string;
  explanation: string;
  loading: boolean;
  onClose: () => void;
};

function formatPlainText(text: string) {
  // Basic cleanup so Gemini output looks consistent without markdown rendering
  return (text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default function StudyAssistant({ concept, explanation, loading, onClose }: Props) {
  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const text = formatPlainText(explanation);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(15, 23, 42, 0.55)", // slate-900 overlay
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        style={{
          width: "min(920px, 96vw)",
          maxHeight: "min(78vh, 780px)",
          background: "#ffffff",
          borderRadius: 24,
          boxShadow: "0 20px 70px rgba(0,0,0,0.35)",
          overflow: "hidden",
          border: "1px solid rgba(226,232,240,1)", // slate-200
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "18px 20px",
            borderBottom: "1px solid rgba(226,232,240,1)",
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                background: "rgba(37, 99, 235, 0.12)",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
              aria-hidden="true"
            >
              ⚡
            </div>

            <div>
              <div style={{ fontWeight: 800, color: "#0f172a" }}>AI Tutor</div>
              <div
                style={{
                  marginTop: 2,
                  fontSize: 12,
                  letterSpacing: 1,
                  color: "#64748b",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                Deep Dive: {concept || "Explanation"}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 22,
              lineHeight: "22px",
              cursor: "pointer",
              color: "#64748b",
              padding: 8,
              borderRadius: 12,
            }}
            aria-label="Close"
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20 }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#334155" }}>
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "999px",
                  border: "3px solid rgba(37,99,235,0.25)",
                  borderTopColor: "rgba(37,99,235,1)",
                  animation: "spin 0.9s linear infinite",
                }}
              />
              <div style={{ fontWeight: 700 }}>Generating explanation…</div>

              <style>
                {`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}
              </style>
            </div>
          ) : (
            <div
              style={{
                whiteSpace: "pre-wrap",
                lineHeight: 1.55,
                color: "#0f172a",
                maxHeight: "50vh",
                overflow: "auto",
                paddingRight: 8,
              }}
            >
              {text || "No explanation returned. Try again."}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 20px",
            borderTop: "1px solid rgba(226,232,240,1)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "#0f172a",
              color: "white",
              border: "none",
              padding: "12px 18px",
              borderRadius: 14,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Got it, thanks!
          </button>
        </div>
      </div>
    </div>
  );
}
