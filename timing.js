const COMMA_END = new Set([',', ';', ':']);
const SENTENCE_END = new Set(['.', '!', '?', '…']);

/**
 * Fetch wordlist.txt and return a Map of lowercase word -> 1-based frequency rank.
 */
export async function loadWordlist() {
  const res = await fetch('/rsvp/wordlist.txt');
  if (!res.ok) throw new Error(`Failed to load wordlist: ${res.status}`);
  const text = await res.text();
  const map = new Map();
  for (const [i, line] of text.trim().split('\n').entries()) {
    const word = line.trim().toLowerCase();
    if (word) map.set(word, i + 1);
  }
  return map;
}

/** Strip leading/trailing punctuation for length and frequency lookups. */
export function stripPunctuation(word) {
  return word.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '');
}

/**
 * Extra pause (ms) from trailing punctuation.
 * Multipliers: comma/;/: 0.75×pauseMult, ./!/? 1.5×pauseMult, em-dash 1.0, hyphen 0.25.
 */
export function calculatePunctuationDelay(word, baseInterval, pauseMult) {
  if (!word) return 0;

  if (word.endsWith('—') || word.endsWith('--')) {
    return baseInterval * 1.0;
  }

  const last = word.slice(-1);

  if (last === '-') {
    return baseInterval * 0.25;
  }

  if (COMMA_END.has(last)) {
    return baseInterval * 0.75 * pauseMult;
  }

  if (SENTENCE_END.has(last)) {
    return baseInterval * 1.5 * pauseMult;
  }

  return 0;
}

/** Extra pause (ms) for words longer than five characters. */
export function calculateLengthDelay(word, baseInterval, factor) {
  const len = stripPunctuation(word).length;
  return Math.max(0, len - 5) * factor * baseInterval;
}

/** Extra pause (ms) based on word frequency rank in the wordlist. */
export function calculateFrequencyDelay(word, baseInterval, factor, wordlist) {
  const key = stripPunctuation(word).toLowerCase();
  const rank = wordlist?.get(key);

  let multiplier;
  if (rank == null) {
    multiplier = 1.0;
  } else if (rank <= 1000) {
    multiplier = 0;
  } else if (rank <= 3000) {
    multiplier = 0.25;
  } else if (rank <= 5000) {
    multiplier = 0.5;
  } else if (rank <= 10000) {
    multiplier = 0.75;
  } else {
    multiplier = 1.0;
  }

  return multiplier * factor * baseInterval;
}

/**
 * Total display time (ms) for one word.
 * @param {object} settings - { pauseMult, lengthDelayEnabled, lengthDelayFactor,
 *   frequencyDelayEnabled, frequencyDelayFactor, wordlist }
 */
export function msPerWord(word, wpm, settings) {
  const baseInterval = 60000 / wpm;
  let ms = baseInterval;

  ms += calculatePunctuationDelay(word, baseInterval, settings.pauseMult);

  if (settings.lengthDelayEnabled) {
    ms += calculateLengthDelay(word, baseInterval, settings.lengthDelayFactor);
  }

  if (settings.frequencyDelayEnabled && settings.wordlist) {
    ms += calculateFrequencyDelay(
      word,
      baseInterval,
      settings.frequencyDelayFactor,
      settings.wordlist,
    );
  }

  return ms;
}