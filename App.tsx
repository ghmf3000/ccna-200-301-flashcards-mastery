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
  const isPro = localStorage.getItem("ccna_isPro") === "true";

  if (premium && !isPro) {
    setAttemptedDeckId(deck.deck_id);
    setAttemptedDeckName(deck.deck_name);
    setView("paywall");
    return;
  }

  localStorage.setItem("ccna_lastDeckId", deck.deck_id);
  localStorage.setItem("ccna_lastDeckName", deck.deck_name);

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
      <div className="bg-white/10 border border-white/15 backdrop-blur-xl rounded-3xl p-6 shadow-2xl mb-8">
  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
    <div>
      <div className="text-white/70 text-xs font-black uppercase tracking-widest">
        Learning Dashboard
      </div>
      <h2 className="text-white text-2xl font-black mt-1">
        Welcome back 👋
      </h2>
      <p className="text-white/70 text-sm mt-2">
        {cards.length} cards • {decks.length} decks • 6 domains
      </p>
    </div>

    <div className="flex gap-3">
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
    );
  }

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col select-none">
      {/* SIGNED OUT (LOGIN) */}
      <SignedOut>
  <div className="min-h-screen relative overflow-hidden flex items-center justify-center px-6">
    {/* Background */}
    <div className="absolute inset-0 bg-gradient-to-br from-[#001c2b] via-[#005073] to-[#0a2540]" />

    {/* Soft glow blobs */}
    <div className="absolute -top-24 -left-24 w-[420px] h-[420px] bg-cyan-400/20 blur-3xl rounded-full" />
    <div className="absolute -bottom-32 -right-24 w-[520px] h-[520px] bg-indigo-400/20 blur-3xl rounded-full" />

    {/* Subtle grid pattern */}
    <svg
      className="absolute inset-0 opacity-[0.08]"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
    >
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
              <div className="text-2xl font-black">500+</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs font-black uppercase tracking-widest text-white/70">Domains</div>
              <div className="text-2xl font-black">6</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-4 col-span-2">
              <div className="text-xs font-black uppercase tracking-widest text-white/70">Includes</div>
              <div className="font-bold text-white/90 mt-1">
                ✅ AI Explain • ✅ TTS • ✅ Progress • ✅ Pro Upgrade
              </div>
            </div>
          </div>

          <p className="text-xs text-white/60">
            Tip: Use Google sign-in for fastest access.
          </p>
        </div>
      </div>

      {/* Right sign-in card (centered) */}
      <div className="flex items-center justify-center">
        <div className="w-full max-w-md">
          <div className="rounded-3xl bg-white/10 border border-white/20 p-6 backdrop-blur-xl shadow-2xl">
            <div className="mb-4">
              <div className="text-white text-xl font-black">Welcome back</div>
              <div className="text-white/70 text-sm">
                Sign in to continue your CCNA study journey.
              </div>
            </div>

            {/* Clerk widget */}
            <div className="flex justify-center">
              <SignIn />
            </div>
          </div>

          {/* Small footer */}
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

    {/* App content */}
    <div className="relative z-10 min-h-screen">
      {/* ✅ Your existing header stays here */}
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

      {/* ✅ Everything else (domainSelect / deckSelect / study / paywall) goes below */}
      <div className="pb-10">
        {/* your existing view-based pages render here */}
      </div>
    </div>
  </div>
</SignedIn>
    </div>
  );
}
