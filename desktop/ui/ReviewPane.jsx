import React from "react";
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  CircleHelp,
  ShieldCheck,
  SquareKanban,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import { IconButton } from "./IconButton.jsx";

const labels = {
  CONFIRMED: "Confirmed",
  TENTATIVE: "Tentative",
  DISCUSSED_ONLY: "Discussed",
  NEEDS_INFO: "Needs info",
};

const filters = [
  ["all", "All items"],
  ["eligible", "Eligible"],
  ["questions", "Needs info"],
];

export function ReviewPane({
  meeting,
  items,
  filter,
  evidenceItemId,
  locked,
  editing,
  onFilterChange,
  onAnalyze,
  onDecide,
  onShowEvidence,
}) {
  const disabled = locked || editing;
  return (
    <section className="review-pane" aria-label="Action review">
      <div className="pane-heading">
        <h2>
          <CheckCheck size={19} /> Action review
        </h2>
        <button
          className="primary"
          disabled={disabled || !meeting.transcript.trim()}
          onClick={onAnalyze}
        >
          <Activity size={16} /> {meeting.analyzed ? "Reanalyze" : "Analyze"}
        </button>
      </div>
      <p className="review-hint">Click an action to see where it was said.</p>
      <div className="tabs" role="tablist" aria-label="Action filters">
        {filters.map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={filter === value}
            onClick={() => onFilterChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="items">
        {!items.length && (
          <div className="empty-items">
            <CircleHelp size={28} />
            <h3>{meeting.analyzed ? "No matching items" : "Awaiting analysis"}</h3>
          </div>
        )}
        {items.map((item) => (
          <article
            className={`action-item ${item.decision} ${evidenceItemId === item.id ? "source-selected" : ""}`}
            key={item.id}
            onClick={(event) => {
              if (editing || event.target.closest("button, a, input, textarea")) return;
              if (!window.getSelection()?.isCollapsed) return;
              onShowEvidence(item);
            }}
          >
            <div className="item-meta">
              <span className={`badge ${item.classification}`}>
                {labels[item.classification] || item.classification}
              </span>
              <span className={item.verified ? "verified" : "unverified"}>
                {item.verified ? (
                  <ShieldCheck size={14} />
                ) : (
                  <CircleHelp size={14} />
                )}
                {item.verified ? "Quote matched" : "Quote not verified"}
              </span>
            </div>
            <h3>
              <button
                className="action-title"
                disabled={editing}
                onClick={() => onShowEvidence(item)}
                aria-label={`View transcript source: ${item.title}`}
                aria-pressed={evidenceItemId === item.id}
              >
                {item.title}
              </button>
            </h3>
            <div className="ownership">
              <span><UserRound size={14} />{item.owner || "Owner missing"}</span>
              <span><CalendarDays size={14} />{item.deadline || "Deadline missing"}</span>
            </div>
            <button
              className="quote"
              disabled={editing}
              onClick={() => onShowEvidence(item)}
              title="Find source quote"
            >
              "{item.quote || "No source quote"}"
            </button>
            <p className="reasoning">{item.reasoning}</p>
            {item.clarifying_question && (
              <p className="question">
                <CircleHelp size={16} />
                {item.clarifying_question}
              </p>
            )}
            {!item.eligible && <p className="small muted">{item.reason}</p>}
            {item.jiraKey && (
              <p className="jira-status">
                <SquareKanban size={14} /> In Jira as{" "}
                <strong>{item.jiraKey}</strong>
                {" - "}
                {item.jiraAssignee
                  ? `assigned to ${item.jiraAssignee}`
                  : "unassigned (owner is not a member of the Jira project)"}
              </p>
            )}
            {!item.jiraKey && item.jiraError && (
              <p className="jira-status failed">
                <SquareKanban size={14} /> Jira: {item.jiraError}
              </p>
            )}
            <div className="decision-row">
              <div className="decision-status">
                <button className="source-link" disabled={editing} onClick={() => onShowEvidence(item)}>
                  {evidenceItemId === item.id ? "Viewing source" : "View source"} <ArrowUpRight size={15} />
                </button>
                <span className="small">
                  {item.decision === "pending"
                    ? "Not reviewed"
                    : item.decision === "approved"
                      ? "Approved"
                      : "Rejected"}
                </span>
              </div>
              <div className="toolbar">
                {item.decision !== "pending" ? (
                  <IconButton
                    label={`Undo decision: ${item.title}`}
                    disabled={disabled}
                    onClick={() => onDecide(item, "pending")}
                  >
                    <Undo2 size={17} />
                  </IconButton>
                ) : (
                  <>
                    <IconButton
                      label={`Reject: ${item.title}`}
                      disabled={disabled}
                      onClick={() => onDecide(item, "rejected")}
                    >
                      <X size={17} />
                    </IconButton>
                    <button
                      className="approve"
                      disabled={disabled || !item.eligible}
                      onClick={() => onDecide(item, "approved")}
                    >
                      <Check size={16} /> Approve
                    </button>
                  </>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
