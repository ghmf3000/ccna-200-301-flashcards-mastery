
import { Deck, Card } from '../types';

const parseRawCSV = (csvText: string): any[] => {
  const lines = csvText.split(/\r?\n/);
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const results: any[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    const obj: any = {};
    headers.forEach((header, index) => {
      obj[header] = values[index];
    });
    results.push(obj);
  }
  return results;
};

export const loadDecks = async (): Promise<Deck[]> => {
  const response = await fetch("/data/decks.csv");
  if (!response.ok) throw new Error("Failed to load decks CSV");
  const text = await response.text();
  return parseRawCSV(text) as Deck[];
};

export const loadCards = async (): Promise<Card[]> => {
  const response = await fetch("/data/cards.csv");
  if (!response.ok) throw new Error("Failed to load cards CSV");
  const text = await response.text();
  return parseRawCSV(text) as Card[];
};
