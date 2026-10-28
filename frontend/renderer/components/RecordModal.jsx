import { Headphones, Mic } from "lucide-react";
import { Modal } from "./Modal.jsx";

export function RecordModal({
  title,
  onTitle,
  error,
  busy,
  locked,
  onClose,
  onSubmit,
}) {
  return (
    <Modal
      title="Record meeting"
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
            value={title}
            maxLength={160}
            onChange={(event) => onTitle(event.target.value)}
            placeholder="Weekly project sync"
          />
        </label>
        <div className="record-sources">
          <span>
            <Mic size={19} /> Default microphone
          </span>
          <span>
            <Headphones size={19} /> Windows system audio
          </span>
        </div>
        <div className="privacy-notice">
          Participant permission required. Other apps and notification sounds
          may also be captured. Use headphones to reduce echo.
        </div>
        <div className="dialog-actions">
          <span className="small muted">30 minutes / 24 MB maximum</span>
          <button className="primary" disabled={locked || !title.trim()}>
            <Mic size={17} /> Start recording
          </button>
        </div>
      </form>
    </Modal>
  );
}
