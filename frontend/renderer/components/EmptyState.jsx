import { AudioLines, FolderOpen, Mic } from "lucide-react";

export function EmptyState({ locked, onRecord, onImport }) {
  return (
    <section className="empty-workspace">
      <div className="empty-symbol">
        <AudioLines size={54} strokeWidth={1.2} />
      </div>
      <span className="eyebrow">TEAM6 MEETINGS</span>
      <h1>Your meeting workspace</h1>
      <div className="empty-actions">
        <button className="primary" disabled={locked} onClick={onRecord}>
          <Mic size={18} /> Record a meeting
        </button>
        <button disabled={locked} onClick={onImport}>
          <FolderOpen size={18} /> Import transcript
        </button>
      </div>
    </section>
  );
}
