import React, { useState, useMemo, useEffect, useRef } from "react";
import { CCNA_DOMAINS, CCNA_Category, Deck, Card, User } from "./types";
import FlashcardComponent from "./components/FlashcardComponent";
import StudyAssistant from "./components/StudyAssistant";
import { explainConcept, type AiTutorResult } from "./services/gemini";
import { loadDecks, loadCards } from "./services/csvParser";
import { startStripeCheckout } from "./services/stripe";
import { SignedIn, SignedOut, SignIn, UserButton, useUser } from "@clerk/clerk-react";

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

const { isLoaded, isSignedIn, user: clerkUser } = useUser();

useEffect(() => {
  if (!isLoaded) return;
  if (isSignedIn) {
    setView("domainSelect");
  } else {
    setView("login");
  }
}, [isLoaded, isSignedIn]);

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
      {view === "login" && (
  <SignedOut>
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      {/* LEFT brand panel */}
      <div className="hidden lg:flex flex-col justify-center px-16 bg-gradient-to-br from-[#002f45] via-[#005073] to-[#0a2540] text-white">
        <div className="max-w-md space-y-6">
          <h1 className="text-4xl font-black leading-tight">
            CCNA Mastery <br /> 200-301 Prep
          </h1>
          <p className="text-white/80 text-lg">
            Flashcards + AI Tutor + Progress tracking — built for serious study.
          </p>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center gap-2">✅ 500+ exam-aligned flashcards</li>
            <li className="flex items-center gap-2">🤖 AI Tutor with clean sections</li>
            <li className="flex items-center gap-2">📊 Mastery tracking by domain</li>
            <li className="flex items-center gap-2">👑 One-time Pro upgrade</li>
          </ul>
        </div>
      </div>

      {/* RIGHT sign-in */}
      <div className="flex items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-md">
          <SignIn />
        </div>
      </div>
    </div>
  </SignedOut>
)}

      {/* ✅ SIGNED IN */}
      <SignedIn>
  <header className="bg-[#005073] text-white shadow-md sticky top-0 z-40 h-16 flex items-center">
    <div className="max-w-6xl mx-auto px-4 w-full flex justify-between items-center">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">CCNA Mastery</h1>
        <span className="bg-amber-400 text-amber-900 text-[10px] font-black px-2 py-0.5 rounded-full uppercase ml-1 shadow-sm">
          PRO
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-white/70 hidden sm:block">
          {clerkUser?.primaryEmailAddress?.emailAddress}
        </span>
        <UserButton afterSignOutUrl="/" />
      </div>
    </div>
  </header>
</SignedIn>
    </>
  );
}
