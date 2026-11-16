// Locating an action item's source quote inside the transcript textarea.

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

// Chromium's setSelectionRange does not scroll a textarea, so measure where the
// match sits with an off-screen mirror that wraps text exactly like the textarea.
function offsetOf(area, index) {
  const style = getComputedStyle(area);
  const mirror = document.createElement("div");
  for (const property of [
    "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom",
    "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth",
    "borderLeftWidth", "fontFamily", "fontSize", "fontWeight", "lineHeight",
    "letterSpacing", "tabSize", "textIndent",
  ])
    mirror.style[property] = style[property];
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    borderStyle: "solid",
  });
  // Account for the textarea's own scrollbar narrowing the text column.
  mirror.style.width = `${area.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`;
  mirror.textContent = area.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}

export function revealRange(area, { start, end }) {
  area.focus({ preventScroll: true });
  area.setSelectionRange(start, end);
  area.scrollTop = Math.max(0, offsetOf(area, start) - area.clientHeight / 3);
  area.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
