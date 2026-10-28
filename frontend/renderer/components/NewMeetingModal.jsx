import { FolderOpen, Mic } from "lucide-react";
import { Modal } from "./Modal.jsx";

export function NewMeetingModal({
  title,
  transcript,
  onTitle,
  onTranscript,
  error,
  busy,
  locked,
  onClose,
  onSubmit,
  onImport,
  onRecordInstead,
}) {
  return (
    <Modal
      title="New meeting"
      error={error}
      busy={busy}
      close={() => !busy && onClose()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label>
          Meeting title
          <input
            autoFocus
            required
            maxLength={160}
            value={title}
            onChange={(event) => onTitle(event.target.value)}
            placeholder="Weekly project sync"
          />
        </label>
        <label>
          Transcript
          <textarea
            rows={7}
            maxLength={100000}
            value={transcript}
            onChange={(event) => onTranscript(event.target.value)}
            placeholder="Paste meeting transcript"
          />
        </label>
        <div className="dialog-actions">
          <button type="button" disabled={locked} onClick={onImport}>
            <FolderOpen size={17} /> Import .txt
          </button>
          <button className="primary" disabled={locked || !title.trim()}>
            Create meeting
          </button>
        </div>
        <button
          className="record-alternative"
          type="button"
          disabled={locked}
          onClick={onRecordInstead}
        >
          <Mic size={17} /> Record a meeting instead
        </button>
      </form>
    </Modal>
  );
}
