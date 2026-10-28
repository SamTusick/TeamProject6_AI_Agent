export const CLASSIFICATION_LABELS = {
  CONFIRMED: "Confirmed",
  TENTATIVE: "Tentative",
  DISCUSSED_ONLY: "Discussed",
  NEEDS_INFO: "Needs info",
};

export const pad2 = (value) => String(value).padStart(2, "0");

export const formatClock = (seconds) =>
  `${pad2(Math.floor(seconds / 60))}:${pad2(seconds % 60)}`;

export const shortDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

export const longDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

export const sortNewestFirst = (meetings) =>
  [...meetings].sort((first, second) =>
    second.createdAt.localeCompare(first.createdAt),
  );
