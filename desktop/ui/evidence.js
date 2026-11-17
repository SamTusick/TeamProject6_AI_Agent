// Locating an action item's source quote inside the original transcript text.

function wordsOf(text) {
  return text
    .split(/\s+/u)
    .map((word) => word.replace(/[^\p{L}\p{N}']+/gu, ""))
    .filter(Boolean);
}

function escape(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Words must appear in order; any whitespace/punctuation may sit between them,
// so curly quotes, commas, dashes or an ellipsis in the quote don't break the match.
function search(words, transcript) {
  if (!words.length) return null;
  const pattern = words.map(escape).join("[^\\p{L}\\p{N}]+");
  const match = new RegExp(pattern, "iu").exec(transcript);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

// Exact quote first, then progressively shorter leading spans so a slightly
// paraphrased quote still lands on where it starts.
export function findQuote(quote, transcript) {
  const words = wordsOf(quote || "");
  const exact = search(words, transcript);
  if (exact) return exact;
  for (let size = Math.min(words.length - 1, 8); size >= 3; size -= 1) {
    for (let from = 0; from + size <= words.length; from += 1) {
      const partial = search(words.slice(from, from + size), transcript);
      if (partial) return partial;
    }
  }
  return null;
}
