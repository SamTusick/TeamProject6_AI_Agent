import { FileText, Headphones } from "lucide-react";
import { shortDate } from "../lib/format.js";

export function MeetingList({
  meetings,
  selected,
  search,
  disabled,
  onSelect,
}) {
  const query = search.toLowerCase();
  const visible = meetings.filter((value) =>
    value.title.toLowerCase().includes(query),
  );
  return (
    <nav className="meeting-list" aria-label="Meetings">
      {visible.map((value) => (
        <button
          key={value.id}
          disabled={disabled}
          className={`meeting-link ${selected === value.id ? "selected" : ""}`}
          onClick={() => onSelect(value.id)}
        >
          {value.source === "Recording" ? (
            <Headphones size={17} />
          ) : (
            <FileText size={17} />
          )}
          <span>
            <strong>{value.title}</strong>
            <small>
              {shortDate(value.createdAt)} /{" "}
              {value.items.filter((item) => item.decision === "approved").length}{" "}
              approved
            </small>
          </span>
        </button>
      ))}
      {!meetings.length && <p className="muted small">No meetings yet.</p>}
      {meetings.length > 0 && !visible.length && (
        <p className="muted small">No matching meetings.</p>
      )}
    </nav>
  );
}
