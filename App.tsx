// App.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CCNA_DOMAINS, CCNA_Category, Deck, Card, User } from "./types";
import FlashcardComponent from "./components/FlashcardComponent";
import StudyAssistant from "./components/StudyAssistant";
import { explainConcept, type AiTutorResult } from "./services/gemini";
import { loadDecks, loadCards } from "./services/csvParser";
import { startStripeCheckout } from "./services/stripe";
import { SignedIn, SignedOut, SignIn, UserButton, useUser } from "@clerk/clerk-react";

type AppView = "login" | "domainSelect" | "deckSelect" | "study" | "paywall";

// Domain color mapping
const DOMAIN_COLORS: Record<number, string> = {
  1: "#2563EB",
  2: "#16A34A",
  3: "#7C3AED",
  4: "#EA580C",
  5: "#DC2626",
  6: "#CA8A04",
};

const getDomainColor = (id: number | null): string => DOMAIN_COLORS[id ?? 0] || "#64748b";

// Helper to handle various truthy strings from CSV
const isPremiumValue = (v: any) => {
  const s = String(v ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "pro", "premium"].includes(s);
};

export default function App() {
  const { isLoaded, isSignedIn, user: clerkUser } = useUser();

  const [view, setView] = useState<AppView>("login");
  const [appUser, setAppUser] = useState<User | null>(null);

  // Data
  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  // Selection
  const [selectedDomainId, setSelectedDomainId] = useState<number | null>(null);
  const [selectedDomainName, setSelectedDomainName] = useState<string | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [selectedDeckName, setSelectedDeckName] = useState<string | null>(null);

  // Paywall
  const [attemptedDeckId, setAttemptedDeckId] = useState<string | null>(null);
  const [attemptedDeckName, setAttemptedDeckName] = useState<string | null>(null);

  // Study
  const [currentIndex, setCurrentIndex] = useState(0);
  const [aiExplanation, setAiExplanation] = useState<AiTutorResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [currentConcept, setCurrentConcept] = useState("");

  // Mastery
  const [masteredIds, setMasteredIds] = useState<Set<string>>(new Set());

  // Speech (browser TTS)
  const [isSpeaking, setIsSpeaking] = useState(false);
  const ttsUtterRef = useRef<SpeechSynthesisUtterance | null>(null);

  // -----------------------------
  // Clerk → View gating
  // -----------------------------
  useEffect(() => {
    if (!isLoaded) return;
    setView(isSignedIn ? "domainSelect" : "login");
  }, [isLoaded, isSignedIn]);

  // Clerk → local app user model
  useEffect(() => {
    if (!clerkUser) {
      setAppUser(null);
      return;
    }
    setAppUser({
      email: clerkUser.primaryEmailAddress?.emailAddress ?? "User",
      isPro: localStorage.getItem("ccna_isPro") === "true",
      isGuest: false,
    });
  }, [clerkUser]);

  // -----------------------------
  // Load CSV data
  // -----------------------------
  useEffect(() => {
    (async () => {
      try {
        const [d, c] = await Promise.all([loadDecks(), loadCards()]);
        setDecks(d);
        setCards(c);
        setIsDataLoading(false);

        // Stripe success/cancel handling (optional)
        const urlParams = new URLSearchParams(window.location.search);
        const success = urlParams.get("success");
        const canceled = urlParams.get("canceled");

        if (success === "true") {
          localStorage.setItem("ccna_isPro", "true");

          // If they returned to a specific deck, resume
          const resumeId = urlParams.get("deckId");
          const resumeName = urlParams.get("deckName");
          if (resumeId) {
            setSelectedDeckId(resumeId);
            setSelectedDeckName(resumeName);
            setView("study");
          }

          window.history.replaceState({}, document.title, window.location.pathname);
        } else if (canceled === "true") {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch (e) {
        console.error(e);
        setDataError("Failed to load decks/cards. Please refresh.");
        setIsDataLoading(false);
      }
    })();
  }, []);

  // Load mastery
  useEffect(() => {
    const saved = localStorage.getItem("ccna_mastery");
    if (!saved) return;
    try {
      setMasteredIds(new Set(JSON.parse(saved)));
    } catch {
      // ignore
    }
  }, []);

  // Save mastery
  useEffect(() => {
    localStorage.setItem("ccna_mastery", JSON.stringify(Array.from(masteredIds)));
  }, [masteredIds]);

  // Cleanup TTS
  useEffect(() => {
    return () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {}
    };
  }, []);

  // -----------------------------
  // Derived lists
  // -----------------------------
  const domainDecksList = useMemo(() => {
    if (!selectedDomainId) return [];
    return decks
      .filter((d) => Number(d.domain_int) === selectedDomainId)
      .sort((a, b) => Number(a.deck_order) - Number(b.deck_order));
  }, [decks, selectedDomainId]);

  const deckCards = useMemo(() => {
    if (!selectedDeckId) return [];
    return cards.filter((c) => c.deck_id === selectedDeckId);
  }, [cards, selectedDeckId]);

  const studyCards = useMemo(() => {
    return deckCards.map((c) => ({
      id: c.card_id,
      question: c.front,
      answer: c.back,
      explanation: c.explanation,
      cliExample: (c.cli_config && c.cli_verify) ? `${c.cli_config}\n${c.cli_verify}` : (c.cli_config || c.cli_verify),
      category: CCNA_Category.NetworkFundamentals,
      difficulty: "Medium" as const,
      domainId: selectedDomainId || 0,
      deckId: c.deck_id,
      deckName: c.deck_name,
      isPremium: isPremiumValue(c.is_premium),
    }));
  }, [deckCards, selectedDomainId]);

  const currentCard = studyCards[currentIndex];

  // -----------------------------
  // Actions
  // -----------------------------
  const toggleMastery = (id: string) => {
    const next = new Set(masteredIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setMasteredIds(next);
  };

  const handleDeckSelect = (deck: Deck) => {
    const premium = isPremiumValue(deck.is_premium);

    if (premium && !appUser?.isPro) {
      setAttemptedDeckId(deck.deck_id);
      setAttemptedDeckName(deck.deck_name);
      setView("paywall");
      return;
    }

    setSelectedDeckId(deck.deck_id);
    setSelectedDeckName(deck.deck_name);
    setCurrentIndex(0);
    setView("study");
  };

  const handleExplain = async (concept: string) => {
    setCurrentConcept(concept);

    // Instant UI: open modal immediately
    setAiLoading(true);
    setAiExplanation(null);

    try {
      const res = await explainConcept(concept, currentCard?.answer || "");
      setAiExplanation(res);
    } catch (e) {
      setAiExplanation({
        title: "AI Tutor",
        simpleExplanation: "Error connecting to AI tutor.",
        realWorldExample: "",
        keyCommands: [],
        commonMistakes: [],
        quickCheck: [],
      });
    } finally {
      setAiLoading(false);
    }
  };

  const handleSpeak = (text: string) => {
    try {
      if (!text?.trim()) return;

      window.speechSynthesis.cancel();

      const utter = new SpeechSynthesisUtterance(text);
      ttsUtterRef.current = utter;

      utter.rate = 1;
      utter.pitch = 1;
      utter.onstart = () => setIsSpeaking(true);
      utter.onend = () => setIsSpeaking(false);
      utter.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utter);
    } catch {
      setIsSpeaking(false);
    }
  };

  // -----------------------------
  // Loading / errors
  // -----------------------------
  if (isDataLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-white font-bold tracking-widest animate-pulse uppercase">
            Syncing Database...
          </p>
        </div>
      </div>
    );
  }

  if (dataError) {
    return (
      <div className="min-h-screen bg-red-900 flex items-center justify-center p-6">
        <div className="bg-white p-8 rounded-3xl max-w-sm w-full text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Sync Error</h2>
          <p className="text-slate-500 mb-6">{dataError}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-slate-800 text-white rounded-xl font-bold"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col select-none">
      {/* SIGNED OUT (LOGIN) */}
      <SignedOut>
        {view === "login" && (
          <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
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

            <div className="flex items-center justify-center bg-slate-50 px-6">
              <div className="w-full max-w-md">
                <SignIn />
              </div>
            </div>
          </div>
        )}
      </SignedOut>

      {/* SIGNED IN (APP) */}
      <SignedIn>
        {/* Header */}
        <header className="bg-[#005073] text-white shadow-md sticky top-0 z-40 h-16 flex items-center">
          <div className="max-w-6xl mx-auto px-4 w-full flex justify-between items-center">
            <div className="flex items-center gap-3">
              {(view !== "domainSelect") && (
                <button
                  onClick={() => {
                    if (view === "study") setView("deckSelect");
                    else setView("domainSelect");
                  }}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                  aria-label="Back"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}

              <h1 className="text-xl font-bold">CCNA Mastery</h1>

              {appUser?.isPro && (
                <span className="bg-amber-400 text-amber-900 text-[10px] font-black px-2 py-0.5 rounded-full uppercase ml-1 shadow-sm">
                  PRO
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-white/70 hidden sm:block">
                {clerkUser?.primaryEmailAddress?.emailAddress}
              </span>
              <UserButton afterSignOutUrl="/" />
            </div>
          </div>
        </header>

        {/* DOMAIN SELECT */}
        {view === "domainSelect" && (
          <main className="flex-1 max-w-6xl mx-auto p-6 w-full">
            <div className="mb-6">
              <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tight">
                Learning Dashboard
              </h2>
              <p className="text-slate-500 font-medium">
                Choose a domain to start studying.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-10">
              {CCNA_DOMAINS.map((domain) => (
                <button
                  key={domain.id}
                  onClick={() => {
                    setSelectedDomainId(domain.id);
                    setSelectedDomainName(domain.subtitle);
                    setView("deckSelect");
                  }}
                  style={{ borderLeftColor: getDomainColor(domain.id) }}
                  className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 border-l-[6px] hover:border-blue-500 hover:shadow-xl transition-all text-left"
                >
                  <div className="text-4xl mb-4">{domain.icon}</div>
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: getDomainColor(domain.id) }}>
                    {domain.title}
                  </h3>
                  <h4 className="text-xl font-bold text-slate-800 leading-tight mt-1">
                    {domain.subtitle}
                  </h4>
                  <p className="text-xs text-slate-400 mt-2 line-clamp-2">
                    {domain.description}
                  </p>
                </button>
              ))}
            </div>
          </main>
        )}

        {/* DECK SELECT */}
        {view === "deckSelect" && (
          <main className="flex-1 max-w-2xl mx-auto p-6 w-full">
            <div className="flex flex-col gap-4 mb-6">
              <button
                onClick={() => setView("domainSelect")}
                className="flex items-center gap-2 text-slate-400 hover:text-blue-600 font-bold text-xs uppercase tracking-widest transition-colors w-fit"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to Domains
              </button>

              <h2 className="text-2xl font-black uppercase tracking-tight" style={{ color: getDomainColor(selectedDomainId) }}>
                {selectedDomainName ? `${selectedDomainName} Decks` : "Available Decks"}
              </h2>
            </div>

            <div className="space-y-4">
              {domainDecksList.map((deck) => {
                const deckCardsCount = cards.filter((c) => c.deck_id === deck.deck_id).length;
                const premium = isPremiumValue(deck.is_premium);
                const isLocked = premium && !appUser?.isPro;

                return (
                  <button
                    key={deck.deck_id}
                    onClick={() => handleDeckSelect(deck)}
                    className={`group w-full bg-white p-6 rounded-2xl border flex justify-between items-center transition-all text-left ${
                      isLocked
                        ? "border-amber-100 hover:bg-amber-50/50"
                        : "border-slate-200 hover:border-blue-300 hover:shadow-lg hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-bold text-slate-800">{deck.deck_name}</h3>
                        {premium ? (
                          <span className="text-[8px] bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded font-black uppercase shadow-sm">
                            PRO 🔒
                          </span>
                        ) : (
                          <span className="text-[8px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded font-black uppercase">
                            FREE
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                        {deckCardsCount} Cards
                      </p>
                    </div>

                    {isLocked ? (
                      <div className="w-10 h-10 bg-amber-50 rounded-full flex items-center justify-center text-amber-500 shadow-inner">
                        🔒
                      </div>
                    ) : (
                      <div className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 group-hover:text-blue-500 group-hover:bg-blue-50 transition-colors">
                        →
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </main>
        )}

        {/* STUDY */}
        {view === "study" && (
          <main className="flex-1 flex flex-col items-center justify-center p-4 max-w-4xl mx-auto w-full">
            {studyCards.length === 0 ? (
              <div className="bg-white p-12 rounded-3xl text-center shadow-xl border border-slate-200">
                <div className="text-5xl mb-4">📭</div>
                <h3 className="text-xl font-bold text-slate-800">Deck is Empty</h3>
                <p className="text-slate-500 mt-2 text-sm">
                  No cards mapped for ID:{" "}
                  <code className="bg-slate-100 px-1 rounded font-mono text-xs">{selectedDeckId}</code>
                </p>
                <button
                  onClick={() => setView("deckSelect")}
                  className="mt-8 px-8 py-3 bg-[#005073] text-white rounded-xl font-bold hover:bg-[#003f5a] transition-all shadow-lg"
                >
                  Return to Decks
                </button>
              </div>
            ) : (
              <div className="w-full max-w-lg space-y-8 flex flex-col items-center">
                <div className="w-full space-y-3">
                  <div className="flex justify-between items-end">
                    <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] line-clamp-1 flex-1">
                      {selectedDeckName}
                    </h2>
                    <span
                      className="text-xs font-bold bg-blue-50 px-2 py-1 rounded"
                      style={{ color: getDomainColor(selectedDomainId) }}
                    >
                      {currentIndex + 1} / {studyCards.length}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden shadow-inner">
                    <div
                      className="h-full transition-all duration-500 ease-out rounded-full"
                      style={{
                        width: `${((currentIndex + 1) / studyCards.length) * 100}%`,
                        backgroundColor: getDomainColor(selectedDomainId),
                      }}
                    />
                  </div>
                </div>

                {currentCard && (
                  <FlashcardComponent
                    card={currentCard}
                    isMastered={masteredIds.has(currentCard.id)}
                    onMastered={() => toggleMastery(currentCard.id)}
                    onExplain={handleExplain}
                    onSpeak={handleSpeak}
                    isSpeaking={isSpeaking}
                    domainColor={getDomainColor(selectedDomainId)}
                  />
                )}

                <div className="flex items-center gap-8 pb-10">
                  <button
                    onClick={() => setCurrentIndex((prev) => (prev - 1 + studyCards.length) % studyCards.length)}
                    className="p-5 bg-white rounded-full shadow-lg text-slate-400 hover:text-blue-600 transition-all border border-slate-100"
                  >
                    ←
                  </button>
                  <button
                    onClick={() => setCurrentIndex((prev) => (prev + 1) % studyCards.length)}
                    className="p-5 bg-white rounded-full shadow-lg text-slate-400 hover:text-blue-600 transition-all border border-slate-100"
                  >
                    →
                  </button>
                </div>
              </div>
            )}
          </main>
        )}

        {/* PAYWALL */}
        {view === "paywall" && (
          <main className="flex-1 flex items-center justify-center p-6">
            <div className="bg-white p-10 rounded-[3rem] shadow-2xl max-w-md w-full text-center space-y-8 border border-amber-100">
              <div className="text-6xl">👑</div>
              <div>
                <h2 className="text-3xl font-black text-slate-800 tracking-tight">Unlock Pro</h2>
                <p className="text-slate-500 font-medium mt-2 leading-relaxed">
                  The deck <span className="text-slate-800 font-bold">"{attemptedDeckName}"</span> is part of CCNA Mastery Pro.
                </p>
              </div>
              <div className="space-y-4">
                <button
                  onClick={() => startStripeCheckout(attemptedDeckId, attemptedDeckName)}
                  className="w-full py-5 bg-amber-500 text-white rounded-2xl font-black text-lg shadow-xl hover:bg-amber-600 transition-all"
                >
                  Pay $39 to Unlock Pro
                </button>
                <button onClick={() => setView("deckSelect")} className="w-full py-3 text-slate-400 font-bold hover:text-slate-600 transition-colors">
                  Maybe later
                </button>
              </div>
              <div className="flex items-center justify-center gap-4 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                <span>One-time payment</span>
                <span className="w-1 h-1 bg-slate-300 rounded-full" />
                <span>Lifetime access</span>
              </div>
            </div>
          </main>
        )}

        {/* AI MODAL */}
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
      </SignedIn>
    </div>
  );
}
