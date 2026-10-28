import { useState } from "react";
import { Activity, CheckCheck, CircleHelp } from "lucide-react";
import { ItemCard } from "./ItemCard.jsx";

const FILTERS = [
  ["all", "All items"],
  ["eligible", "Eligible"],
  ["questions", "Needs info"],
];

const matchesFilter = (item, filter) =>
  filter === "all" ||
  (filter === "eligible" && item.eligible) ||
  (filter === "questions" && item.classification === "NEEDS_INFO");

export function ActionReview({
  meeting,
  locked,
  editing,
  onAnalyze,
  onDecide,
  onShowEvidence,
}) {
  const [filter, setFilter] = useState("all");
  const visibleItems = meeting.items.filter((item) =>
    matchesFilter(item, filter),
  );
  return (
    <section className="review-pane">
      <div className="pane-heading">
        <h2>
          <CheckCheck size={19} /> Action review
        </h2>
        <button
          className="primary"
          disabled={locked || editing || !meeting.transcript.trim()}
          onClick={onAnalyze}
        >
          <Activity size={16} /> {meeting.analyzed ? "Reanalyze" : "Analyze"}
        </button>
      </div>
      <div className="tabs" role="tablist" aria-label="Action filters">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="items">
        {!visibleItems.length && (
          <div className="empty-items">
            <CircleHelp size={28} />
            <h3>
              {meeting.analyzed ? "No matching items" : "Awaiting analysis"}
            </h3>
          </div>
        )}
        {visibleItems.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            disabled={locked || editing}
            onShowEvidence={onShowEvidence}
            onDecide={onDecide}
          />
        ))}
      </div>
    </section>
  );
}
