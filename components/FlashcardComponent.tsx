import React, { useState } from 'react';
import { Flashcard } from '../types';

interface FlashcardProps {
  card: Flashcard;
  isMastered: boolean;
  onMastered: () => void;
  onExplain: (concept: string) => void;
  onSpeak: (text: string) => void;
  isSpeaking: boolean;
  domainColor?: string;
}

const FlashcardComponent: React.FC<FlashcardProps> = ({ 
  card, 
  isMastered, 
  onMastered, 
  onExplain, 
  onSpeak,
  isSpeaking,
  domainColor = '#2563EB'
}) => {
  const [isFlipped, setIsFlipped] = useState(false);

  const toggleFlip = () => setIsFlipped(!isFlipped);

  if (!card) return null;

  return (
    <div className="w-full max-w-lg h-[450px] perspective-1000 cursor-pointer group">
      <div 
        className={`relative w-full h-full transition-transform duration-700 transform-style-3d ${isFlipped ? 'rotate-y-180' : ''}`}
        onClick={toggleFlip}
      >
        {/* Front Side */}
        <div className={`absolute inset-0 backface-hidden border rounded-3xl shadow-xl flex flex-col p-10 items-center justify-center text-center transition-colors ${isMastered ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200'}`}>
          <div className="absolute top-6 left-6 flex items-center gap-2">
            <span 
              className={`text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-[0.1em] ${isMastered ? 'bg-green-600 text-white' : ''}`}
              style={!isMastered ? { backgroundColor: `${domainColor}15`, color: domainColor } : undefined}
            >
              {isMastered ? '✓ Mastered' : card.category}
            </span>
          </div>
          
          <button 
            onClick={(e) => { e.stopPropagation(); onSpeak(card.question); }}
            className={`absolute top-6 right-6 p-2 rounded-full transition-all ${isSpeaking ? 'bg-blue-600 text-white animate-pulse' : 'bg-slate-100 text-slate-400 hover:text-blue-600'}`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          </button>

          <h2 className="text-2xl md:text-3xl font-bold text-slate-800 leading-tight">
            {card.question}
          </h2>
          
          <div className="mt-8 flex flex-col items-center gap-2">
             <div className="w-8 h-1 rounded-full" style={{ backgroundColor: `${domainColor}30` }}></div>
             <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Tap to reveal</p>
          </div>
        </div>

        {/* Back Side */}
        <div className="absolute inset-0 backface-hidden rotate-y-180 bg-slate-900 rounded-3xl shadow-2xl flex flex-col p-8 text-white overflow-hidden border-4 border-slate-800">
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
            <div className="flex justify-between items-start mb-4 border-b border-white/10 pb-2">
               <h3 className="text-xl font-bold" style={{ color: domainColor }}>Answer</h3>
               <button 
                onClick={(e) => { e.stopPropagation(); onSpeak(card.answer + ". " + (card.explanation || "")); }}
                className={`p-2 rounded-full transition-all ${isSpeaking ? 'bg-blue-600 text-white animate-pulse' : 'bg-white/10 text-white/50 hover:text-white'}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </button>
            </div>
            
            <p className="text-2xl font-semibold mb-6">
              {card.answer}
            </p>

            {card.explanation && (
              <div className="mb-6 bg-white/5 p-4 rounded-xl">
                <h4 className="text-[10px] font-black uppercase tracking-widest mb-2 opacity-80" style={{ color: domainColor }}>Instructor Insight</h4>
                <p className="text-slate-300 text-sm leading-relaxed">
                  {card.explanation}
                </p>
              </div>
            )}

            {card.cliExample && (
              <div className="mb-6">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-green-400/60 mb-2">Live Configuration</h4>
                <div className="bg-black/80 p-4 rounded-xl border border-white/5 font-mono text-xs text-green-400 overflow-x-auto whitespace-pre">
                  {card.cliExample}
                </div>
              </div>
            )}
          </div>
          
          <div className="pt-6 mt-4 border-t border-white/10 flex gap-3">
            <button 
              onClick={(e) => { e.stopPropagation(); onExplain(card.question); }}
              className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" style={{ color: domainColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              AI EXPLAIN
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onMastered(); }}
              className={`flex-1 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${isMastered ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
              style={!isMastered ? { backgroundColor: domainColor } : undefined}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {isMastered ? 'MASTERED ✓' : 'MARK MASTERED'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FlashcardComponent;