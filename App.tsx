import React, { useState, useMemo, useEffect, useRef } from "react";
import { CCNA_DOMAINS, CCNA_Category, Deck, Card, User } from "./types";
import FlashcardComponent from "./components/FlashcardComponent";
import StudyAssistant from "./components/StudyAssistant";
import { explainConcept, type AiTutorResult } from "./services/gemini";
import { loadDecks, loadCards } from "./services/csvParser";
import { startStripeCheckout } from "./services/stripe";
import { SignedIn, SignedOut, SignIn, useUser } from "@clerk/clerk-react";

type AppView = "domainSelect" | "deckSelect" | "study" | "paywall";

// Domain color mapping
const DOMAIN_COLORS: Record<number, string> = {
  1: "#2563EB",
  2: "#16A34A",
  3: "#7C3AED",
  4: "#EA580C",
  5: "#DC2626",
  6: "#CA8A04",
};

const getDomainColor = (id: number | null): string =>
  DOMAIN_COLORS[id ?? 0] || "#64748b";

const isPremiumValue = (v: any) => {
  const s = String(v ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "pro", "premium"].includes(s);
};

export default function App() {
  const { user: clerkUser } = useUser();

  const [view, setView] = useState<AppView>("domainSelect");
  const [user, setUser] = useState<User | null>(null);

  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);

  const [selectedDomainId, setSelectedDomainId] = useState<number | null>(null);
  const [selectedDomainName, setSelectedDomainName] = useState<string | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [selectedDeckName, setSelectedDeckName] = useState<string | null>(null);

  const [attemptedDeckId, setAttemptedDeckId] = useState<string | null>(null);
  const [attemptedDeckName, setAttemptedDeckName] = useState<string | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [aiExplanation, setAiExplanation] = useState<AiTutorResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [currentConcept, setCurrentConcept] = useState("");

  const [masteredIds, setMasteredIds] = useState<Set<string>>(new Set());

  const ttsUtterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  /* ---------- LOAD DATA ---------- */
  useEffect(() => {
    (async () => {
      const [d, c] = await Promise.all([loadDecks(), loadCards()]);
      setDecks(d);
      setCards(c);
      setIsDataLoading(false);
    })();
  }, []);

  /* ---------- CLERK → APP USER ---------- */
  useEffect(() => {
    if (clerkUser) {
      setUser({
        email: clerkUser.primaryEmailAddress?.emailAddress ?? "User",
        isPro: localStorage.getItem("ccna_isPro") === "true",
        isGuest: false,
      });
    }
  }, [clerkUser]);

  /* ---------- STUDY DATA ---------- */
  const domainDecksList = useMemo(() => {
    if (!selectedDomainId) return [];
    return decks.filter(d => Number(d.domain_int) === selectedDomainId);
  }, [decks, selectedDomainId]);

  const deckCards = useMemo(() => {
    if (!selectedDeckId) return [];
    return cards.filter(c => c.deck_id === selectedDeckId);
  }, [cards, selectedDeckId]);

  const studyCards = useMemo(() => {
    return deckCards.map(c => ({
      id: c.card_id,
      question: c.front,
      answer: c.back,
      explanation: c.explanation,
      cliExample: c.cli_config || c.cli_verify,
      category: CCNA_Category.NetworkFundamentals,
      difficulty: "Medium" as const,
      domainId: selectedDomainId || 0,
      deckId: c.deck_id,
      deckName: c.deck_name,
      isPremium: isPremiumValue(c.is_premium),
    }));
  }, [deckCards, selectedDomainId]);

  const currentCard = studyCards[currentIndex];

  /* ---------- AI ---------- */
  const handleExplain = async (concept: string) => {
    setCurrentConcept(concept);
    setAiLoading(true);
    try {
      const res = await explainConcept(concept, currentCard?.answer || "");
      setAiExplanation(res);
    } finally {
      setAiLoading(false);
    }
  };

  /* ---------- TTS ---------- */
  const handleSpeak = (text: string) => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    ttsUtterRef.current = u;
    u.onstart = () => setIsSpeaking(true);
    u.onend = () => setIsSpeaking(false);
    window.speechSynthesis.speak(u);
  };

  /* ---------- UI ---------- */
  if (isDataLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  }

  return (
    <>
      {/* 🔒 SIGNED OUT */}
      <SignedOut>
        <div className="min-h-screen flex items-center justify-center bg-slate-100">
          <SignIn />
        </div>
      </SignedOut>

      {/* ✅ SIGNED IN */}
      <SignedIn>
        <div className="min-h-screen bg-slate-50">
          {view === "domainSelect" && (
            <main className="max-w-6xl mx-auto p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
              {CCNA_DOMAINS.map(d => (
                <button
                  key={d.id}
                  onClick={() => {
                    setSelectedDomainId(d.id);
                    setSelectedDomainName(d.subtitle);
                    setView("deckSelect");
                  }}
                  className="bg-white p-6 rounded-2xl shadow"
                >
                  <h3 className="font-black">{d.subtitle}</h3>
                </button>
              ))}
            </main>
          )}

          {view === "deckSelect" && (
            <main className="max-w-2xl mx-auto p-6 space-y-4">
              {domainDecksList.map(deck => (
                <button
                  key={deck.deck_id}
                  onClick={() => {
                    if (isPremiumValue(deck.is_premium) && !user?.isPro) {
                      setAttemptedDeckId(deck.deck_id);
                      setAttemptedDeckName(deck.deck_name);
                      setView("paywall");
                    } else {
                      setSelectedDeckId(deck.deck_id);
                      setSelectedDeckName(deck.deck_name);
                      setView("study");
                    }
                  }}
                  className="w-full bg-white p-4 rounded-xl border"
                >
                  {deck.deck_name}
                </button>
              ))}
            </main>
          )}

          {view === "study" && currentCard && (
            <main className="flex flex-col items-center p-6">
              <FlashcardComponent
                card={currentCard}
                isMastered={false}
                onMastered={() => {}}
                onExplain={handleExplain}
                onSpeak={handleSpeak}
                isSpeaking={isSpeaking}
                domainColor={getDomainColor(selectedDomainId)}
              />
            </main>
          )}

          {view === "paywall" && (
            <main className="flex items-center justify-center p-6">
              <button
                onClick={() =>
                  startStripeCheckout(attemptedDeckId, attemptedDeckName)
                }
                className="bg-amber-500 text-white px-8 py-4 rounded-xl font-black"
              >
                Unlock Pro ($39)
              </button>
            </main>
          )}

          {(aiExplanation || aiLoading) && (
            <StudyAssistant
              concept={currentConcept}
              result={aiExplanation}
              loading={aiLoading}
              onClose={() => {
                setAiExplanation(null);
                setAiLoading(false);
              }}
            />
          )}
        </div>
      </SignedIn>
    </>
  );
}
