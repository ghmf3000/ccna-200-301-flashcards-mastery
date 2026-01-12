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
  // Load CSV data + Stripe return handling
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
          // keep appUser in sync
          setAppUser((prev) => (prev ? { ...prev, isPro: true } : prev));

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
      cliExample:
        c.cli_config && c.cli_verify ? `${c.cli_config}\n${c.cli_verify}` : c.cli_config || c.cli_verify,
      category: CCNA_Category.NetworkFundamentals,
      difficulty: "Medium" as const,
      domainId: selectedDomainId || 0,
      deckId: c.deck_id,
      deckName: c.deck_name,
      isPremium: isPremiumValue(c.is_premium),
    }));
  }, [deckCards, selectedDomainId]);

  const currentCard = studyCards[currentIndex];

  // Dashboard stats (mastery by domain)
  const domainStats = useMemo(() => {
    const stats: Record<number, { total: number; mastered: number }> = {};
    CCNA_DOMAINS.forEach((d) => {
      const dDecks = decks.filter((deck) => Number(deck.domain_int) === d.id);
      const deckIds = new Set(dDecks.map((x) => x.deck_id));
      const dCards = cards.filter((c) => deckIds.has(c.deck_id));
      const masteredCount = dCards.filter((c) => masteredIds.has(c.card_id)).length;
      stats[d.id] = { total: dCards.length, mastered: masteredCount };
    });
    return stats;
  }, [decks, cards, masteredIds]);

  // Resume
  const lastDeckId = localStorage.getItem("ccna_lastDeckId");
  const lastDeckName = localStorage.getItem("ccna_lastDeckName");
  const canResume = !!lastDeckId && decks.some((d) => d.deck_id === lastDeckId);

  // Pro
  const isPro = localStorage.getItem("ccna_isPro") === "true";

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
    const proNow = localStorage.getItem("ccna_isPro") === "true";

    if (premium && !proNow) {
      setAttemptedDeckId(deck.deck_id);
      setAttemptedDeckName(deck.deck_name);
      setView("paywall");
      return;
    }

    // ✅ save for resume
    localStorage.setItem("ccna_lastDeckId", deck.deck_id);
    localStorage.setItem("ccna_lastDeckName", deck.deck_name);

    setSelectedDeckId(deck.deck_id);
    setSelectedDeckName(deck.deck_name);
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

  const goBack = () => {
    if (view === "study") setView("deckSelect");
    else if (view === "deckSelect") setView("domainSelect");
  };

  // -----------------------------
  // Shared background wrappers
  // -----------------------------
  const SignedInShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[#061526] via-[#071a2e] to-[#0b2a3f]" />
      <div className="absolute -top-24 -left-24 w-[420px] h-[420px] bg-cyan-400/10 blur-3xl rounded-full" />
      <div className="absolute -bottom-32 -right-24 w-[520px] h-[520px] bg-indigo-400/10 blur-3xl rounded-full" />
      <div className="relative z-10 min-h-screen">{children}</div>
    </div>
  );

  // -----------------------------
  // Loading / errors
  // -----------------------------
  if (isDataLoading) {
    return (
      <SignedInShell>
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="w-full max-w-md rounded-3xl bg-white/10 border border-white/15 backdrop-blur-xl p-6 shadow-2xl text-center">
            <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
            <div className="text-white font-black mt-4">Syncing CCNA Database…</div>
            <div className="text-white/70 text-sm mt-1">Loading decks and cards</div>
          </div>
        </div>
      </SignedInShell>
    );
  }

  if (dataError) {
    return (
      <SignedInShell>
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="w-full max-w-md rounded-3xl bg-white/10 border border-white/15 backdrop-blur-xl p-6 shadow-2xl text-center">
            <div className="text-4xl">⚠️</div>
            <div className="text-white font-black mt-3">Sync Error</div>
            <div className="text-white/70 text-sm mt-2">{dataError}</div>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 w-full py-3 rounded-2xl bg-white text-slate-900 font-black shadow-lg hover:opacity-95"
            >
              Retry
            </button>
          </div>
        </div>
      </SignedInShell>
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

          {/* Foreground */}
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
                    <div className="text-2xl font-black">500+</div>
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
        <SignedInShell>
          {/* Header */}
          <header className="bg-[#005073] text-white shadow-md sticky top-0 z-40 h-16 flex items-center">
            <div className="max-w-6xl mx-auto px-4 w-full flex justify-between items-center">
              <div className="flex items-center gap-3">
                {(view === "deckSelect" || view === "study" || view === "paywall") && (
                  <button onClick={goBack} className="p-2 hover:bg-white/10 rounded-full transition-colors" aria-label="Back">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}

                <h1 className="text-xl font-bold">CCNA Mastery</h1>

                {isPro ? (
                  <span className="bg-amber-400 text-amber-900 text-[10px] font-black px-2 py-0.5 rounded-full uppercase ml-1 shadow-sm">
                    PRO
                  </span>
                ) : (
                  <span className="bg-white/10 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase ml-1">
                    FREE
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

          {/* Content */}
          <div className="pb-10">
            {/* DOMAIN SELECT */}
            {view === "domainSelect" && (
              <main className="max-w-6xl mx-auto p-6 w-full">
                {/* Hero */}
                <div className="rounded-3xl bg-white/10 border border-white/15 backdrop-blur-xl p-6 shadow-2xl mb-8">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                    <div>
                      <div className="text-white/70 text-xs font-black uppercase tracking-widest">Learning Dashboard</div>
                      <h2 className="text-white text-2xl font-black mt-1">Welcome back 👋</h2>
                      <p className="text-white/70 text-sm mt-2">
                        {cards.length} cards • {decks.length} decks • 6 domains
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      {canResume && (
                        <button
                          onClick={() => {
                            setSelectedDeckId(lastDeckId!);
                            setSelectedDeckName(lastDeckName || "Last Deck");
                            setView("study");
                          }}
                          className="px-5 py-3 rounded-2xl bg-white text-slate-900 font-black shadow-lg hover:opacity-95"
                        >
                          Resume: {lastDeckName || "Last Deck"}
                        </button>
                      )}

                      <button
                        onClick={() => {
                          localStorage.removeItem("ccna_lastDeckId");
                          localStorage.removeItem("ccna_lastDeckName");
                          window.location.reload();
                        }}
                        className="px-5 py-3 rounded-2xl bg-white/10 border border-white/15 text-white font-black hover:bg-white/15"
                      >
                        Clear Resume
                      </button>
                    </div>
                  </div>
                </div>

                {/* Domain cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {CCNA_DOMAINS.map((domain) => {
                    const stats = domainStats[domain.id] || { total: 0, mastered: 0 };
                    const progress = stats.total > 0 ? Math.round((stats.mastered / stats.total) * 100) : 0;
                    const color = getDomainColor(domain.id);

                    return (
                      <button
                        key={domain.id}
                        onClick={() => {
                          setSelectedDomainId(domain.id);
                          setSelectedDomainName(domain.subtitle);
                          setView("deckSelect");
                        }}
                        className="group text-left rounded-3xl bg-white/10 border border-white/15 backdrop-blur-xl p-6 shadow-xl hover:bg-white/15 transition-all relative overflow-hidden"
                      >
                        <div className="absolute top-0 left-0 h-1" style={{ width: `${progress}%`, backgroundColor: color }} />
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color }}>
                              Domain {domain.id}
                            </div>
                            <div className="text-white text-xl font-black mt-1">{domain.subtitle}</div>
                            <div className="text-white/70 text-xs mt-2 line-clamp-2">{domain.description}</div>
                          </div>
                          <div className="text-3xl">{domain.icon}</div>
                        </div>

                        <div className="mt-5 flex items-center justify-between">
                          <div className="text-white/70 text-xs font-black uppercase tracking-widest">
                            {stats.mastered}/{stats.total} mastered
                          </div>
                          <div className="text-white/70 text-xs font-black uppercase tracking-widest">{progress}%</div>
                        </div>

                        <div className="mt-2 h-2 w-full rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: color }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </main>
            )}

            {/* DECK SELECT */}
            {view === "deckSelect" && (
              <main className="max-w-3xl mx-auto p-6 w-full">
                <div className="mb-6">
                  <div className="text-white/70 text-xs font-black uppercase tracking-widest">Choose a deck</div>
                  <h2 className="text-white text-2xl font-black mt-1" style={{ color: getDomainColor(selectedDomainId) }}>
                    {selectedDomainName ? `${selectedDomainName} Decks` : "Decks"}
                  </h2>
                </div>

                <div className="space-y-4">
                  {domainDecksList.map((deck) => {
                    const deckCardsCount = cards.filter((c) => c.deck_id === deck.deck_id).length;
                    const deckMasteredCount = cards.filter((c) => c.deck_id === deck.deck_id && masteredIds.has(c.card_id)).length;

                    const premium = isPremiumValue(deck.is_premium);
                    const locked = premium && !isPro;

                    return (
                      <button
                        key={deck.deck_id}
                        onClick={() => handleDeckSelect(deck)}
                        className={`w-full text-left rounded-2xl p-5 shadow-xl backdrop-blur-xl border transition-all ${
                          locked
                            ? "bg-amber-500/10 border-amber-300/30 hover:bg-amber-500/15"
                            : "bg-white/10 border-white/15 hover:bg-white/15"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="text-white font-black text-lg truncate">{deck.deck_name}</div>
                              {premium ? (
                                <span className="text-[10px] bg-amber-400 text-amber-900 px-2 py-0.5 rounded-full font-black uppercase">
                                  PRO 🔒
                                </span>
                              ) : (
                                <span className="text-[10px] bg-white/10 text-white px-2 py-0.5 rounded-full font-black uppercase">
                                  FREE
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap gap-3 mt-2 text-xs font-black uppercase tracking-widest">
                              <span className="text-white/70">{deckCardsCount} cards</span>
                              {deckMasteredCount > 0 && <span className="text-green-300">✓ {deckMasteredCount} mastered</span>}
                            </div>
                          </div>

                          <div className="flex-shrink-0">
                            {locked ? (
                              <div className="w-10 h-10 rounded-full bg-amber-400/15 border border-amber-300/30 flex items-center justify-center text-amber-200">
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                  <path
                                    fillRule="evenodd"
                                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-white/70">
                                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </main>
            )}

            {/* STUDY */}
            {view === "study" && (
              <main className="max-w-4xl mx-auto p-6 w-full">
                {studyCards.length === 0 ? (
                  <div className="rounded-3xl bg-white/10 border border-white/15 backdrop-blur-xl p-10 shadow-2xl text-center">
                    <div className="text-5xl">📭</div>
                    <div className="text-white font-black text-xl mt-4">Deck is Empty</div>
                    <div className="text-white/70 text-sm mt-2">
                      No cards mapped for ID:{" "}
                      <code className="bg-white/10 px-2 py-1 rounded text-xs">{selectedDeckId}</code>
                    </div>
                    <button
                      onClick={() => setView("deckSelect")}
                      className="mt-6 px-6 py-3 rounded-2xl bg-white text-slate-900 font-black shadow-lg hover:opacity-95"
                    >
                      Return to Decks
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-6">
                    {/* Top bar */}
                    <div className="w-full rounded-3xl bg-white/10 border border-white/15 backdrop-blur-xl p-5 shadow-xl">
                      <div className="flex items-end justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-white/70 text-xs font-black uppercase tracking-widest truncate">
                            {selectedDeckName}
                          </div>
                          <div className="text-white text-lg font-black mt-1">
                            Card {currentIndex + 1} of {studyCards.length}
                          </div>
                        </div>

                        <div className="text-xs font-black uppercase tracking-widest px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-white/80">
                          Domain {selectedDomainId ?? "—"}
                        </div>
                      </div>

                      <div className="mt-4 h-2 w-full bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${((currentIndex + 1) / studyCards.length) * 100}%`,
                            backgroundColor: getDomainColor(selectedDomainId),
                          }}
                        />
                      </div>
                    </div>

                    {/* Flashcard */}
                    {currentCard && (
                      <div className="w-full flex justify-center">
                        <FlashcardComponent
                          card={currentCard}
                          isMastered={masteredIds.has(currentCard.id)}
                          onMastered={() => toggleMastery(currentCard.id)}
                          onExplain={handleExplain}
                          onSpeak={handleSpeak}
                          isSpeaking={isSpeaking}
                          domainColor={getDomainColor(selectedDomainId)}
                        />
                      </div>
                    )}

                    {/* Nav buttons */}
                    <div className="flex items-center gap-6">
                      <button
                        onClick={() => setCurrentIndex((prev) => (prev - 1 + studyCards.length) % studyCards.length)}
                        className="p-4 rounded-full bg-white/10 border border-white/15 text-white/80 hover:bg-white/15 active:scale-95 transition"
                        aria-label="Previous card"
                      >
                        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>

                      <button
                        onClick={() => setCurrentIndex((prev) => (prev + 1) % studyCards.length)}
                        className="p-4 rounded-full bg-white/10 border border-white/15 text-white/80 hover:bg-white/15 active:scale-95 transition"
                        aria-label="Next card"
                      >
                        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </main>
            )}

            {/* PAYWALL */}
            {view === "paywall" && (
              <main className="max-w-md mx-auto p-6 w-full">
                <div className="rounded-3xl bg-amber-500/10 border border-amber-300/25 backdrop-blur-xl p-8 shadow-2xl text-center">
                  <div className="text-6xl">👑</div>
                  <div className="text-white font-black text-2xl mt-4">Unlock Pro</div>
                  <div className="text-white/70 text-sm mt-2 leading-relaxed">
                    The deck <span className="text-white font-black">"{attemptedDeckName}"</span> is part of CCNA Mastery Pro.
                    Unlock all premium content today.
                  </div>

                  <button
                    onClick={() => startStripeCheckout(attemptedDeckId, attemptedDeckName)}
                    className="mt-6 w-full py-4 rounded-2xl bg-amber-400 text-amber-900 font-black shadow-xl hover:opacity-95"
                  >
                    Pay $39 to Unlock Pro
                  </button>

                  <button
                    onClick={() => setView("deckSelect")}
                    className="mt-3 w-full py-3 rounded-2xl bg-white/10 border border-white/15 text-white font-black hover:bg-white/15"
                  >
                    Maybe later
                  </button>

                  <div className="mt-6 flex items-center justify-center gap-3 text-[10px] text-white/60 font-black uppercase tracking-widest">
                    <span>One-time payment</span>
                    <span className="w-1 h-1 bg-white/40 rounded-full" />
                    <span>Lifetime access</span>
                  </div>
                </div>
              </main>
            )}

            {/* AI Modal */}
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
        </SignedInShell>
      </SignedIn>
    </div>
  );
}
