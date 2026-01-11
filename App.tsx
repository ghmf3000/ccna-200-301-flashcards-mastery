import React, { useState, useMemo, useEffect, useRef } from 'react';
import { CCNA_DOMAINS, CCNA_Category, Deck, Card, User } from './types';
import FlashcardComponent from './components/FlashcardComponent';
import StudyAssistant from './components/StudyAssistant';
import { explainConcept, type AiTutorResult } from './services/gemini';
import { loadDecks, loadCards } from './services/csvParser';
import { startStripeCheckout } from './services/stripe';

type AppView = 'login' | 'domainSelect' | 'deckSelect' | 'study' | 'paywall';

// Domain color mapping for consistent visual identity
const DOMAIN_COLORS: Record<number, string> = {
  1: '#2563EB', // Blue (Network Fundamentals)
  2: '#16A34A', // Green (Network Access)
  3: '#7C3AED', // Purple (IP Connectivity)
  4: '#EA580C', // Orange (IP Services)
  5: '#DC2626', // Red (Security Fundamentals)
  6: '#CA8A04', // Yellow (Automation)
};

const getDomainColor = (id: number | null): string => {
  if (!id) return '#64748b'; // Default Slate-500
  return DOMAIN_COLORS[id] || '#64748b';
};

// Helper to handle various truthy strings from CSV
const isPremiumValue = (v: any) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y" || s === "pro" || s === "premium";
};

const App: React.FC = () => {
  const [view, setView] = useState<AppView>('login');
  const [user, setUser] = useState<User | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Data state
  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  // Selection state
  const [selectedDomainId, setSelectedDomainId] = useState<number | null>(null);
  const [selectedDomainName, setSelectedDomainName] = useState<string | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [selectedDeckName, setSelectedDeckName] = useState<string | null>(null);

  // Attempted navigation (for paywall flow)
  const [attemptedDeckId, setAttemptedDeckId] = useState<string | null>(null);
  const [attemptedDeckName, setAttemptedDeckName] = useState<string | null>(null);

  // Study state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [aiExplanation, setAiExplanation] = useState<AiTutorResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [currentConcept, setCurrentConcept] = useState<string>('');
  const [isShuffled, setIsShuffled] = useState(false);
  const [shuffledIndices, setShuffledIndices] = useState<number[]>([]);

  // Mastery tracking
  const [masteredIds, setMasteredIds] = useState<Set<string>>(new Set());

  // Speech state (browser TTS)
  const [isSpeaking, setIsSpeaking] = useState(false);
  const ttsUtterRef = useRef<SpeechSynthesisUtterance | null>(null);

  // 1. Initial Load - Data and URL parameters for Stripe success/cancel
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [loadedDecks, loadedCards] = await Promise.all([
          loadDecks(),
          loadCards()
        ]);

        setDecks(loadedDecks);
        setCards(loadedCards);
        setIsDataLoading(false);

        // Check for URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const success = urlParams.get('success');
        const canceled = urlParams.get('canceled');

        if (success === 'true') {
          localStorage.setItem('ccna_isPro', 'true');
          setToast({ message: "Payment Successful! Pro Unlocked.", type: 'success' });

          // Auto-resume logic
          const resumeId = urlParams.get('deckId');
          const resumeName = urlParams.get('deckName');
          if (resumeId) {
            setSelectedDeckId(resumeId);
            setSelectedDeckName(resumeName);
            setView('study');
          }

          // Clean URL
          window.history.replaceState({}, document.title, window.location.pathname);
        } else if (canceled === 'true') {
          setToast({ message: "Payment Canceled.", type: 'error' });
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch (err) {
        console.error("Data fetch error:", err);
        setDataError("Failed to initialize CCNA database. Please refresh.");
        setIsDataLoading(false);
      }
    };

    fetchData();
  }, []);

  // 2. Load User Session and Mastery from LocalStorage on mount
  useEffect(() => {
    const savedMastery = localStorage.getItem('ccna_mastery');
    if (savedMastery) {
      try {
        setMasteredIds(new Set(JSON.parse(savedMastery)));
      } catch (e) {
        console.error("Mastery load failed");
      }
    }

    const savedUser = localStorage.getItem('ccna_user');
    const isProPersistent = localStorage.getItem('ccna_isPro') === 'true';

    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser) as User;
        if (parsed && parsed.email) {
          setUser({ ...parsed, isPro: isProPersistent });
          setView('domainSelect');
        }
      } catch (e) {
        console.error("User session load failed");
        localStorage.removeItem('ccna_user');
      }
    } else if (isProPersistent) {
      // If we are Pro but not logged in, we can auto-login as a Pro Guest
      const guestPro: User = { email: 'Guest', isPro: true, isGuest: true };
      setUser(guestPro);
      setView('domainSelect');
    }
  }, []);

  // Clear toast after 5s
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Save mastery changes
  useEffect(() => {
    localStorage.setItem('ccna_mastery', JSON.stringify(Array.from(masteredIds)));
  }, [masteredIds]);

  // Clean up TTS on unmount
  useEffect(() => {
    return () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {}
    };
  }, []);

  // Dashboard Stats
  const domainStats = useMemo(() => {
    const stats: Record<number, { total: number; mastered: number }> = {};
    CCNA_DOMAINS.forEach(d => {
      const domainDecks = decks.filter(deck => Number(deck.domain_int) === d.id);
      const domainDeckIds = new Set(domainDecks.map(deck => deck.deck_id));
      const domainCards = cards.filter(c => domainDeckIds.has(c.deck_id));
      const masteredCount = domainCards.filter(c => masteredIds.has(c.card_id)).length;
      stats[d.id] = { total: domainCards.length, mastered: masteredCount };
    });
    return stats;
  }, [decks, cards, masteredIds]);

  // Deck Select List
  const domainDecksList = useMemo(() => {
    if (!selectedDomainId) return [];
    return decks
      .filter(d => Number(d.domain_int) === selectedDomainId)
      .sort((a, b) => Number(a.deck_order) - Number(b.deck_order));
  }, [decks, selectedDomainId]);

  // Study Card Filtering
  const deckCards = useMemo(() => {
    const targetDeckId = selectedDeckId || attemptedDeckId;
    if (!targetDeckId) return [];
    return cards.filter(c => c.deck_id === targetDeckId);
  }, [cards, selectedDeckId, attemptedDeckId]);

  const studyCards = useMemo(() => {
    return deckCards.map(c => ({
      id: c.card_id,
      question: c.front,
      answer: c.back,
      explanation: c.explanation,
      cliExample: (c.cli_config && c.cli_verify) ? `${c.cli_config}\n${c.cli_verify}` : (c.cli_config || c.cli_verify),
      category: CCNA_Category.NetworkFundamentals,
      difficulty: 'Medium' as const,
      domainId: selectedDomainId || 0,
      deckId: c.deck_id,
      deckName: c.deck_name,
      isPremium: isPremiumValue(c.is_premium)
    }));
  }, [deckCards, selectedDomainId]);

  useEffect(() => {
    const indices = Array.from({ length: studyCards.length }, (_, i) => i);
    if (isShuffled) {
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
    }
    setShuffledIndices(indices);
    setCurrentIndex(0);
  }, [isShuffled, studyCards]);

  const activeIndex = shuffledIndices[currentIndex] ?? 0;
  const currentCard = studyCards[activeIndex];

  const handleLogin = (asGuest: boolean) => {
    const isProPersistent = localStorage.getItem('ccna_isPro') === 'true';
    const newUser: User = {
      email: asGuest ? 'Guest' : 'user@example.com',
      isPro: isProPersistent,
      isGuest: asGuest
    };
    setUser(newUser);
    localStorage.setItem('ccna_user', JSON.stringify(newUser));
    setView('domainSelect');
  };

  const handleLogout = () => {
    localStorage.removeItem('ccna_user');
    // Note: we DO NOT remove ccna_isPro, as it is a permanent purchase for the browser
    setUser(null);
    setView('login');
    setSelectedDomainId(null);
    setSelectedDomainName(null);
    setSelectedDeckId(null);
    setSelectedDeckName(null);
    setAttemptedDeckId(null);
    setAttemptedDeckName(null);
    setCurrentIndex(0);
    setIsShuffled(false);

    // stop speech if any
    try {
      window.speechSynthesis.cancel();
    } catch {}
    setIsSpeaking(false);
    ttsUtterRef.current = null;
  };

  const handleDeckSelect = (deck: Deck) => {
    const premium = isPremiumValue(deck.is_premium);

    if (premium && !user?.isPro) {
      setAttemptedDeckId(deck.deck_id);
      setAttemptedDeckName(deck.deck_name);
      setView("paywall");
      return;
    }

    setSelectedDeckId(deck.deck_id);
    setSelectedDeckName(deck.deck_name);
    setAttemptedDeckId(null);
    setAttemptedDeckName(null);
    setCurrentIndex(0);
    setView('study');
  };

  const toggleMastery = (id: string) => {
    const next = new Set(masteredIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setMasteredIds(next);
  };

  // ✅ Browser-native TTS (no Gemini key required)
  const handleSpeak = (text: string) => {
    try {
      if (!text?.trim()) return;

      // stop any current speech first
      window.speechSynthesis.cancel();

      const utter = new SpeechSynthesisUtterance(text);
      ttsUtterRef.current = utter;

      utter.rate = 1;
      utter.pitch = 1;

      utter.onstart = () => setIsSpeaking(true);
      utter.onend = () => setIsSpeaking(false);
      utter.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.error("TTS error:", e);
      setIsSpeaking(false);
    }
  };

 const handleExplain = async (concept: string) => {
  setCurrentConcept(concept);

  // Instant UI: open modal immediately
  setAiLoading(true);
  setAiExplanation(null);

  try {
    const result = await explainConcept(concept, currentCard?.answer || "");
    setAiExplanation(result);
  } catch (error) {
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


  if (isDataLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-white font-bold tracking-widest animate-pulse uppercase">Syncing Database...</p>
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
          <button onClick={() => window.location.reload()} className="w-full py-3 bg-slate-800 text-white rounded-xl font-bold">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col select-none">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl font-bold text-white animate-in slide-in-from-bottom-8 duration-300 ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      {view !== 'login' && user && (
        <header className="bg-[#005073] text-white shadow-md sticky top-0 z-40 h-16 flex items-center">
          <div className="max-w-6xl mx-auto px-4 w-full flex justify-between items-center">
            <div className="flex items-center gap-3">
              {(view !== 'domainSelect' && view !== 'paywall') && (
                <button onClick={() => setView(view === 'study' ? 'deckSelect' : 'domainSelect')} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
              )}
              <h1 className="text-xl font-bold">CCNA Mastery</h1>
              {user.isPro && <span className="bg-amber-400 text-amber-900 text-[10px] font-black px-2 py-0.5 rounded-full uppercase ml-1 shadow-sm">PRO</span>}
              {user.isGuest && !user.isPro && <span className="bg-slate-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase ml-1">Guest</span>}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="text-xs font-bold text-white/50 hover:text-white uppercase tracking-widest transition-colors cursor-pointer outline-none"
            >
              Logout
            </button>
          </div>
        </header>
      )}

      {view === 'login' && (
        <main className="flex-1 flex items-center justify-center p-6 bg-gradient-to-br from-[#005073] to-[#002f45]">
          <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl max-w-md w-full text-center space-y-8 animate-in zoom-in duration-500">
            <div className="text-6xl">📚</div>
            <h2 className="text-3xl font-black text-slate-800 tracking-tight">CCNA Mastery</h2>
            <div className="space-y-4">
              <button onClick={() => handleLogin(false)} className="w-full py-4 bg-[#005073] text-white rounded-2xl font-bold shadow-lg hover:bg-[#003f5a] transition-all">Sign In</button>
              <button onClick={() => handleLogin(true)} className="w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-all">Continue as Guest</button>
            </div>
          </div>
        </main>
      )}

      {view === 'domainSelect' && user && (
        <main className="flex-1 max-w-6xl mx-auto p-6 w-full overflow-y-auto">
          <div className="flex justify-between items-end mb-8">
            <div>
              <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Learning Dashboard</h2>
              <p className="text-slate-500 font-medium">Welcome back! Accessing {cards.length} cards across {decks.length} decks.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-10">
            {CCNA_DOMAINS.map((domain) => {
              const stats = domainStats[domain.id] || { total: 0, mastered: 0 };
              const progress = stats.total > 0 ? (stats.mastered / stats.total) * 100 : 0;
              const color = getDomainColor(domain.id);

              return (
                <button
                  key={domain.id}
                  onClick={() => {
                    setSelectedDomainId(domain.id);
                    setSelectedDomainName(domain.subtitle);
                    setView('deckSelect');
                  }}
                  style={{ borderLeftColor: color }}
                  className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 border-l-[6px] hover:border-blue-500 hover:shadow-xl transition-all text-left relative overflow-hidden group"
                >
                  <div
                    className={`absolute top-0 right-0 h-1 transition-all duration-1000 ${progress === 100 ? 'bg-green-500 w-full' : ''}`}
                    style={{ width: progress + '%', backgroundColor: progress === 100 ? undefined : color }}
                  ></div>
                  <div className="text-4xl mb-4">{domain.icon}</div>
                  <div className="flex justify-between items-center mb-1">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color }}>{domain.title}</h3>
                    <span className="text-[10px] font-black text-slate-400">{stats.mastered}/{stats.total} Mastered</span>
                  </div>
                  <h4 className="text-xl font-bold text-slate-800 leading-tight mb-2">{domain.subtitle}</h4>
                  <p className="text-xs text-slate-400 line-clamp-2">{domain.description}</p>
                </button>
              );
            })}
          </div>
        </main>
      )}

      {view === 'deckSelect' && (
        <main className="flex-1 max-w-2xl mx-auto p-6 w-full">
          <div className="flex flex-col gap-6 mb-8">
            <button
              onClick={() => setView('domainSelect')}
              className="flex items-center gap-2 text-slate-400 hover:text-blue-600 font-bold text-xs uppercase tracking-widest transition-colors w-fit"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              Back to Domains
            </button>
            <h2
              className="text-2xl font-black uppercase tracking-tight"
              style={{ color: getDomainColor(selectedDomainId) }}
            >
              {selectedDomainName ? `${selectedDomainName} Decks` : "Available Decks"}
            </h2>
          </div>

          <div className="space-y-4">
            {domainDecksList.map((deck) => {
              const deckCardsCount = cards.filter(c => c.deck_id === deck.deck_id).length;
              const deckMasteredCount = cards.filter(c => c.deck_id === deck.deck_id && masteredIds.has(c.card_id)).length;
              const premium = isPremiumValue(deck.is_premium);
              const isLocked = premium && !user?.isPro;

              return (
                <button
                  key={deck.deck_id}
                  onClick={() => handleDeckSelect(deck)}
                  className={`group w-full bg-white p-6 rounded-2xl border flex justify-between items-center transition-all text-left ${isLocked ? 'border-amber-100 hover:bg-amber-50/50' : 'border-slate-200 hover:border-blue-300 hover:shadow-lg hover:bg-slate-50'}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-bold text-slate-800">{deck.deck_name}</h3>
                      {premium ? (
                        <span className="text-[8px] bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded font-black uppercase shadow-sm">PRO 🔒</span>
                      ) : (
                        <span className="text-[8px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded font-black uppercase">FREE</span>
                      )}
                    </div>
                    <div className="flex gap-4">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{deckCardsCount} Cards</p>
                      {deckMasteredCount > 0 && (
                        <p className="text-xs font-bold text-green-500 uppercase tracking-widest">✓ {deckMasteredCount} Mastered</p>
                      )}
                    </div>
                  </div>

                  {isLocked ? (
                    <div className="w-10 h-10 bg-amber-50 rounded-full flex items-center justify-center text-amber-500 shadow-inner group-hover:scale-110 transition-transform">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
                    </div>
                  ) : (
                    <div className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 group-hover:text-blue-500 group-hover:bg-blue-50 transition-colors">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </main>
      )}

      {view === 'study' && (
        <main className="flex-1 flex flex-col items-center justify-center p-4 max-w-4xl mx-auto w-full">
          {studyCards.length === 0 ? (
            <div className="bg-white p-12 rounded-3xl text-center shadow-xl border border-slate-200 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="text-5xl mb-4">📭</div>
              <h3 className="text-xl font-bold text-slate-800">Deck is Empty</h3>
              <p className="text-slate-500 mt-2 text-sm">No cards mapped for ID: <code className="bg-slate-100 px-1 rounded font-mono text-xs">{selectedDeckId}</code></p>
              <button onClick={() => setView('deckSelect')} className="mt-8 px-8 py-3 bg-[#005073] text-white rounded-xl font-bold hover:bg-[#003f5a] transition-all shadow-lg">Return to Decks</button>
            </div>
          ) : (
            <div className="w-full max-w-lg space-y-8 flex flex-col items-center">
              <div className="w-full space-y-3">
                <div className="flex justify-between items-end">
                  <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] line-clamp-1 flex-1">{selectedDeckName}</h2>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <button onClick={() => setIsShuffled(!isShuffled)} className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded transition-all transform active:scale-95 ${isShuffled ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}>Shuffle</button>
                    <span className="text-xs font-bold bg-blue-50 px-2 py-1 rounded" style={{ color: getDomainColor(selectedDomainId) }}>{currentIndex + 1} / {studyCards.length}</span>
                  </div>
                </div>
                <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden shadow-inner">
                  <div className="h-full transition-all duration-700 ease-out rounded-full" style={{ width: `${((currentIndex + 1) / studyCards.length) * 100}%`, backgroundColor: getDomainColor(selectedDomainId) }}></div>
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
                <button onClick={() => setCurrentIndex(prev => (prev - 1 + studyCards.length) % studyCards.length)} className="p-5 bg-white rounded-full shadow-lg text-slate-400 hover:text-blue-600 hover:scale-110 transition-all active:scale-90 border border-slate-100">
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg>
                </button>
                <button onClick={() => setCurrentIndex(prev => (prev + 1) % studyCards.length)} className="p-5 bg-white rounded-full shadow-lg text-slate-400 hover:text-blue-600 hover:scale-110 transition-all active:scale-90 border border-slate-100">
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>
            </div>
          )}
        </main>
      )}

      {view === 'paywall' && (
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white p-10 rounded-[3rem] shadow-2xl max-w-md w-full text-center space-y-8 border border-amber-100 animate-in fade-in zoom-in duration-500">
            <div className="text-6xl drop-shadow-lg">👑</div>
            <div>
              <h2 className="text-3xl font-black text-slate-800 tracking-tight">Unlock Pro</h2>
              <p className="text-slate-500 font-medium mt-2 leading-relaxed">
                The deck <span className="text-slate-800 font-bold">"{attemptedDeckName}"</span> is part of CCNA Mastery Pro.
                Unlock all premium content and advanced AI tutoring today.
              </p>
            </div>
            <div className="space-y-4">
              <button
                onClick={() => startStripeCheckout(attemptedDeckId, attemptedDeckName)}
                className="w-full py-5 bg-amber-500 text-white rounded-2xl font-black text-lg shadow-xl hover:bg-amber-600 hover:scale-[1.02] transition-all transform active:scale-95 flex items-center justify-center gap-2"
              >
                <span>Pay $39 to Unlock Pro</span>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
              </button>
              <button onClick={() => setView('deckSelect')} className="w-full py-3 text-slate-400 font-bold hover:text-slate-600 transition-colors">Maybe later</button>
            </div>
            <div className="flex items-center justify-center gap-4 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
              <span>One-time payment</span>
              <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
              <span>Lifetime access</span>
            </div>
          </div>
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
  );
};

export default App;
