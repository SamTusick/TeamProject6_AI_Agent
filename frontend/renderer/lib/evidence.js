export function selectQuote(area, quote, transcript) {
  if (!area) return;
  area.focus();
  const pattern = quote
    .trim()
    .split(/\s+/u)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  if (!pattern) return;
  const match = new RegExp(pattern, "iu").exec(transcript);
  if (match)
    area.setSelectionRange(match.index, match.index + match[0].length);
}
