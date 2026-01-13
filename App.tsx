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
  const lastSpokenKeyRef = useRef<string>(""); // lets us toggle stop on same button

  const isPro = (appUser?.isPro ?? false) || localStorage.getItem("ccna_isPro") === "true";

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

        // Stripe success/cancel handling
        const urlParams = new URLSearchParams(window.location.search);
        const success = urlParams.get("success");
        const canceled = urlParams.get("canceled");

        if (success === "true") {
          localStorage.setItem("ccna_isPro", "true");

          const resumeId = urlParams.get("deckId");
          const resumeName = urlParams.get("deckName");
          if (resumeId) {
            setSelectedDeckId(resumeId);
            setSelectedDeckName(resumeName);
            setCurrentIndex(0);
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

  // Cleanup TTS on unmount
  useEffect(() => {
    return () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {}
      setIsSpeaking(false);
      lastSpokenKeyRef.current = "";
      ttsUtterRef.current = null;
    };
  }, []);

  // -----------------------------
  // Derived lists
  // -----------------------------
  const domainStats = useMemo(() => {
    const stats: Record<number, { total: number; mastered: number }> = {};
    CCNA_DOMAINS.forEach((d) => {
      const domainDecks = decks.filter((deck) => Number(deck.domain_int) === d.id);
      const domainDeckIds = new Set(domainDecks.map((deck) => deck.deck_id));
      const domainCards = cards.filter((c) => domainDeckIds.has(c.deck_id));
      const masteredCount = domainCards.filter((c) => masteredIds.has(c.card_id)).length;
      stats[d.id] = { total: domainCards.length, mastered: masteredCount };
    });
    return stats;
  }, [decks, cards, masteredIds]);

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
      cliExample:
        c.cli_config && c.cli_verify ? `${c.cli_config}\n${c.cli_verify}` : (c.cli_config || c.cli_verify),
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
  const stopSpeaking = () => {
    try {
      window.speechSynthesis.cancel();
    } catch {}
    setIsSpeaking(false);
    lastSpokenKeyRef.current = "";
    ttsUtterRef.current = null;
  };

  const toggleMastery = (id: string) => {
    const next = new Set(masteredIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setMasteredIds(next);
  };

  const handleDeckSelect = (deck: Deck) => {
    const premium = isPremiumValue(deck.is_premium);

    if (premium && !isPro) {
      setAttemptedDeckId(deck.deck_id);
      setAttemptedDeckName(deck.deck_name);
      setView("paywall");
      return;
    }

    // stop any speech when switching content
    stopSpeaking();

    localStorage.setItem("ccna_lastDeckId", deck.deck_id);
    localStorage.setItem("ccna_lastDeckName", deck.deck_name);

    setSelectedDeckId(deck.deck_id);
    setSelectedDeckName(deck.deck_name);
    setAttemptedDeckId(null);
    setAttemptedDeckName(null);
    setCurrentIndex(0);
    setView("study");
  };

  const handleExplain = async (concept: string) => {
    setCurrentConcept(concept);
    setAiLoading(true);
    setAiExplanation(null);

    try {
      const res = await explainConcept(concept, currentCard?.answer || "");
      setAiExplanation(res);
    } catch {
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

  /**
   * ✅ FIXED: Speaker toggles stop/start
   * - If already speaking the same “key”, clicking again stops immediately.
   * - If speaking something else, it stops and starts new speech.
   */
  const handleSpeak = (text: string) => {
    try {
      const t = (text ?? "").trim();
      if (!t) return;

      const key = `${selectedDeckId || "noDeck"}::${currentCard?.id || "noCard"}::${t.slice(0, 80)}`;

      // If currently speaking the same thing → stop
      if (isSpeaking && lastSpokenKeyRef.current === key) {
        stopSpeaking();
        return;
      }

      // Otherwise stop any current speech and start new
      stopSpeaking();

      const utter = new SpeechSynthesisUtterance(t);
      ttsUtterRef.current = utter;
      lastSpokenKeyRef.current = key;

      utter.rate = 1;
      utter.pitch = 1;

      utter.onstart = () => setIsSpeaking(true);
      utter.onend = () => {
        setIsSpeaking(false);
        lastSpokenKeyRef.current = "";
        ttsUtterRef.current = null;
      };
      utter.onerror = () => {
        setIsSpeaking(false);
        lastSpokenKeyRef.current = "";
        ttsUtterRef.current = null;
      };

      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.error("TTS error:", e);
      stopSpeaking();
    }
  };

  const goBack = () => {
    stopSpeaking();
    if (view === "study") setView("deckSelect");
    else if (view === "deckSelect" || view === "paywall") setView("domainSelect");
  };

  // -----------------------------
  // Loading / errors
  // -----------------------------
  if (isDataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-white/40 border-t-transparent rounded-full animate-spin" />
          <div className="text-sm font-bold">Loading decks…</div>
        </div>
      </div>
    );
  }

  if (dataError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white p-6">
        <div className="max-w-md w-full rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="text-lg font-black">Sync Error</div>
          <p className="text-white/70 mt-2 text-sm">{dataError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 w-full py-3 rounded-2xl bg-white text-slate-900 font-black"
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
    <div className="min-h-screen flex flex-col select-none">
      {/* SIGNED OUT (LOGIN) */}
      <SignedOut>
        <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-6">
          {/* Background */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#001c2b] via-[#005073] to-[#0a2540]" />

          {/* Soft glow blobs */}
          <div className="absolute -top-24 -left-24 w-[420px] h-[420px] bg-cyan-400/20 blur-3xl rounded-full" />
          <div className="absolute -bottom-32 -right-24 w-[520px] h-[520px] bg-indigo-400/20 blur-3xl rounded-full" />

          {/* Subtle grid pattern */}
          <svg className="absolute inset-0 opacity-[0.08]" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="42" height="42" patternUnits="userSpaceOnUse">
                <path d="M 42 0 L 0 0 0 42" fill="none" stroke="white" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>

          {/* Foreground content */}
          <div className="relative w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            {/* Left marketing panel */}
            <div className="hidden lg:block text-white">
              <div className="max-w-md space-y-6">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-widest">
                  <span className="text-lg">📚</span> CCNA 200-301 Prep
                </div>

                <h1 className="text-4xl font-black leading-tight">
                  CCNA Mastery
                  <br />
                  Flashcards + AI Tutor
                </h1>

                <p className="text-white/80 text-lg leading-relaxed">
                  Study smarter with domain-based decks, mastery tracking, and an AI tutor that explains concepts with real CLI examples.
                </p>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-white/10 p-4">
                    <div className="text-xs font-black uppercase tracking-widest text-white/70">Cards</div>
                    <div className="text-2xl font-black">{cards.length || "—"}</div>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-4">
                    <div className="text-xs font-black uppercase tracking-widest text-white/70">Domains</div>
                    <div className="text-2xl font-black">6</div>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-4 col-span-2">
                    <div className="text-xs font-black uppercase tracking-widest text-white/70">Includes</div>
                    <div className="font-bold text-white/90 mt-1">✅ AI Explain • ✅ TTS • ✅ Progress • ✅ Pro Upgrade</div>
                  </div>
                </div>

                <p className="text-xs text-white/60">Tip: Use Google sign-in for fastest access.</p>
              </div>
            </div>

            {/* Right sign-in card (centered) */}
            <div className="flex items-center justify-center">
              <div className="w-full max-w-md">
                <div className="rounded-3xl bg-white/10 border border-white/20 p-6 backdrop-blur-xl shadow-2xl">
                  <div className="mb-4">
                    <div className="text-white text-xl font-black">Welcome back</div>
                    <div className="text-white/70 text-sm">Sign in to continue your CCNA study journey.</div>
                  </div>

                  <div className="flex justify-center">
                    <SignIn />
                  </div>
                </div>

                <div className="mt-4 text-center text-xs text-white/60">
                  By signing in, you’ll be able to track mastery across devices.
                </div>
              </div>
            </div>
          </div>
        </div>
      </SignedOut>

      {/* SIGNED IN (APP) */}
      <SignedIn>
        <div className="min-h-screen relative overflow-hidden">
          {/* Signed-in background */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#061526] via-[#071a2e] to-[#0b2a3f]" />
          <div className="absolute -top-24 -left-24 w-[420px] h-[420px] bg-cyan-400/10 blur-3xl rounded-full" />
          <div className="absolute -bottom-32 -right-24 w-[520px] h-[520px] bg-indigo-400/10 blur-3xl rounded-full" />

          <div className="relative z-10 min-h-screen flex flex-col">
            {/* Header */}
            <header className="bg-[#005073] text-white shadow-md sticky top-0 z-40 h-16 flex items-center">
              <div className="max-w-6xl mx-auto px-4 w-full flex justify-between items-center">
                <div className="flex items-center gap-3">
                  {(view !== "domainSelect" && view !== "login") && (
                    <button
                      type="button"
                      onClick={goBack}
                      className="p-2 hover:bg-white/10 rounded-full transition-colors"
                      aria-label="Back"
                    >
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                  )}

                  <h1 className="text-xl font-bold">CCNA Mastery</h1>

                  {isPro && (
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

            {/* Body */}
            <div className="flex-1 pb-10">
              {/* DOMAIN SELECT */}
              {view === "domainSelect" && (
                <main className="flex-1 max-w-6xl mx-auto p-6 w-full">
                  <div className="bg-white/10 border border-white/15 backdrop-blur-xl rounded-3xl p-6 shadow-2xl mb-8">
                    <div className="text-white/70 text-xs font-black uppercase tracking-widest">Learning Dashboard</div>
                    <h2 className="text-white text-2xl font-black mt-1">Welcome back 👋</h2>
                    <p className="text-white/70 text-sm mt-2">
                      {cards.length} cards • {decks.length} decks • 6 domains
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {CCNA_DOMAINS.map((domain) => {
                      const stats = domainStats[domain.id] || { total: 0, mastered: 0 };
                      const progress = stats.total > 0 ? (stats.mastered / stats.total) * 100 : 0;
                      const color = getDomainColor(domain.id);

                      return (
                        <button
                          key={domain.id}
                          onClick={() => {
                            stopSpeaking();
                            setSelectedDomainId(domain.id);
                            setSelectedDomainName(domain.subtitle);
                            setView("deckSelect");
                          }}
                          style={{ borderLeftColor: color }}
                          className="bg-white/10 hover:bg-white/15 border border-white/10 rounded-3xl p-6 text-left shadow-2xl backdrop-blur-xl transition-all border-l-[6px]"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color }}>
                                Domain {domain.id}
                              </div>
                              <div className="text-xl font-black text-white mt-1">{domain.subtitle}</div>
                              <div className="text-white/60 text-xs mt-2">{domain.description}</div>
                            </div>
                            <div className="text-2xl">{domain.icon}</div>
                          </div>

                          <div className="mt-5">
                            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-white/60">
                              <span>
                                {stats.mastered}/{stats.total} mastered
                              </span>
                              <span>{Math.round(progress)}%</span>
                            </div>
                            <div className="mt-2 h-2 w-full bg-black/20 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: color }} />
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </main>
              )}

              {/* DECK SELECT */}
              {view === "deckSelect" && (
                <main className="flex-1 max-w-2xl mx-auto p-6 w-full">
                  <div className="mb-6">
                    <h2 className="text-2xl font-black uppercase tracking-tight text-white">
                      {selectedDomainName ? `${selectedDomainName} Decks` : "Available Decks"}
                    </h2>
                    <p className="text-white/60 text-sm mt-1">Choose a deck to start studying.</p>
                  </div>

                  <div className="space-y-4">
                    {domainDecksList.map((deck) => {
                      const premium = isPremiumValue(deck.is_premium);
                      const locked = premium && !isPro;

                      return (
                        <button
                          key={deck.deck_id}
                          onClick={() => handleDeckSelect(deck)}
                          className={`w-full rounded-2xl p-5 text-left border backdrop-blur-xl transition-all ${
                            locked
                              ? "bg-amber-500/10 border-amber-400/30 hover:bg-amber-500/15"
                              : "bg-white/10 border-white/10 hover:bg-white/15"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-white font-black">{deck.deck_name}</div>
                              <div className="text-white/60 text-xs mt-1">
                                {premium ? "PRO 🔒" : "FREE"} • Deck ID: {deck.deck_id}
                              </div>
                            </div>
                            <div className="text-white/60 text-sm font-black">›</div>
                          </div>
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
                    <div className="bg-white/10 border border-white/10 rounded-3xl p-8 text-center text-white">
                      <div className="text-4xl mb-3">📭</div>
                      <div className="text-lg font-black">Deck is Empty</div>
                      <div className="text-white/70 text-sm mt-2">No cards were found for this deck.</div>
                      <button
                        onClick={() => setView("deckSelect")}
                        className="mt-6 px-6 py-3 rounded-2xl bg-white text-slate-900 font-black"
                      >
                        Return to Decks
                      </button>
                    </div>
                  ) : (
                    <div className="w-full max-w-lg space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="text-white/70 text-xs font-black uppercase tracking-widest line-clamp-1">
                          {selectedDeckName}
                        </div>
                        <div className="text-white/80 text-xs font-black">
                          {currentIndex + 1} / {studyCards.length}
                        </div>
                      </div>

                      <FlashcardComponent
                        card={currentCard}
                        isMastered={masteredIds.has(currentCard.id)}
                        onMastered={() => toggleMastery(currentCard.id)}
                        onExplain={handleExplain}
                        onSpeak={handleSpeak}
                        isSpeaking={isSpeaking}
                        domainColor={getDomainColor(selectedDomainId)}
                      />

                      <div className="flex items-center justify-center gap-6 pb-10">
                        <button
                          onClick={() => {
                            stopSpeaking();
                            setCurrentIndex((prev) => (prev - 1 + studyCards.length) % studyCards.length);
                          }}
                          className="p-4 rounded-full bg-white/10 border border-white/10 text-white hover:bg-white/15"
                        >
                          ‹
                        </button>

                        <button
                          onClick={() => {
                            stopSpeaking();
                            setCurrentIndex((prev) => (prev + 1) % studyCards.length);
                          }}
                          className="p-4 rounded-full bg-white/10 border border-white/10 text-white hover:bg-white/15"
                        >
                          ›
                        </button>
                      </div>
                    </div>
                  )}
                </main>
              )}

              {/* PAYWALL */}
              {view === "paywall" && (
                <main className="flex-1 flex items-center justify-center p-6">
                  <div className="bg-white/10 border border-white/10 backdrop-blur-xl rounded-3xl p-8 max-w-md w-full text-center text-white shadow-2xl">
                    <div className="text-5xl mb-4">👑</div>
                    <div className="text-2xl font-black">Unlock Pro</div>
                    <p className="text-white/70 text-sm mt-2">
                      The deck <b className="text-white">"{attemptedDeckName}"</b> is part of CCNA Mastery Pro.
                    </p>

                    <button
                      onClick={() => {
                       const uid = clerkUser?.id;
                       const email = clerkUser?.primaryEmailAddress?.emailAddress;

                       if (!uid) {
                         alert("Please sign in to purchase Pro.");
                         return;
                      }

                      startStripeCheckout(uid, email);
                     }}

                      className="mt-6 w-full py-4 rounded-2xl bg-amber-400 text-amber-900 font-black shadow-lg hover:opacity-95"
                    >
                      Pay $39 to Unlock Pro
                    </button>

                    <button
                      onClick={() => setView("deckSelect")}
                      className="mt-3 w-full py-3 rounded-2xl bg-white/10 border border-white/10 text-white font-black hover:bg-white/15"
                    >
                      Maybe later
                    </button>
                  </div>
                </main>
              )}
            </div>

            {/* AI Tutor Modal */}
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
        </div>
      </SignedIn>
    </div>
  );
}
