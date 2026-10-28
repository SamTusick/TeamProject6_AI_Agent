import { Check, CircleHelp, ShieldCheck, Undo2, X } from "lucide-react";
import { CLASSIFICATION_LABELS } from "../lib/format.js";
import { IconButton } from "./IconButton.jsx";

const DECISION_TEXT = {
  pending: "Not reviewed",
  approved: "Approved",
  rejected: "Rejected",
};

export function ItemCard({ item, disabled, onShowEvidence, onDecide }) {
  return (
    <article className={`action-item ${item.decision}`}>
      <div className="item-meta">
        <span className={`badge ${item.classification}`}>
          {CLASSIFICATION_LABELS[item.classification] || item.classification}
        </span>
        <span className={item.verified ? "verified" : "unverified"}>
          {item.verified ? <ShieldCheck size={14} /> : <CircleHelp size={14} />}
          {item.verified ? "Quote matched" : "Quote not verified"}
        </span>
      </div>
      <h3>{item.title}</h3>
      <div className="ownership">
        <span>{item.owner || "Owner missing"}</span>
        <span>{item.deadline || "Deadline missing"}</span>
      </div>
      <button
        className="quote"
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
      <div className="decision-row">
        <span className="small">{DECISION_TEXT[item.decision]}</span>
        <div className="toolbar">
          {item.decision !== "pending" ? (
            <IconButton
              label={`Undo decision: ${item.title}`}
              disabled={disabled}
              onClick={() => onDecide(item.id, "pending")}
            >
              <Undo2 size={17} />
            </IconButton>
          ) : (
            <>
              <IconButton
                label={`Reject: ${item.title}`}
                disabled={disabled}
                onClick={() => onDecide(item.id, "rejected")}
              >
                <X size={17} />
              </IconButton>
              <button
                className="approve"
                disabled={disabled || !item.eligible}
                onClick={() => onDecide(item.id, "approved")}
              >
                <Check size={16} /> Approve
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
