import { Download, Trash2 } from "lucide-react";
import { longDate, pad2 } from "../lib/format.js";
import { IconButton } from "./IconButton.jsx";

export function MeetingHeader({
  meeting,
  approvedCount,
  locked,
  editing,
  onExport,
  onDelete,
}) {
  return (
    <section className="meeting-heading">
      <div>
        <div className="eyebrow">
          {meeting.source} / {longDate(meeting.createdAt)}
        </div>
        <h1>{meeting.title}</h1>
      </div>
      <div className="toolbar">
        <button
          disabled={locked || !approvedCount || editing}
          onClick={onExport}
        >
          <Download size={17} /> Export {approvedCount > 0 && `(${approvedCount})`}
        </button>
        <IconButton
          label="Delete meeting"
          disabled={locked || editing}
          onClick={onDelete}
        >
          <Trash2 size={18} />
        </IconButton>
      </div>
    </section>
  );
}

export function MeetingStats({ candidates, eligible, approved }) {
  return (
    <section className="metrics">
      <div>
        <strong>{pad2(candidates)}</strong>
        <span>Candidate items</span>
      </div>
      <div>
        <strong>{pad2(eligible)}</strong>
        <span>Eligible for approval</span>
      </div>
      <div>
        <strong className="accent">{pad2(approved)}</strong>
        <span>Approved</span>
      </div>
    </section>
  );
}
