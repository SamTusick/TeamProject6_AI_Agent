import { Square } from "lucide-react";
import { formatClock } from "../lib/format.js";

export function RecordingBand({ elapsed, canvasRef, busy, onStop }) {
  return (
    <section className="recording-band" aria-label="Active recording">
      <div>
        <span className="recording-dot" /> <strong>Recording</strong>
        <span className="timer">{formatClock(elapsed)}</span>
      </div>
      <canvas
        ref={canvasRef}
        width="480"
        height="56"
        aria-label="Live mixed audio levels"
      />
      <button className="stop" disabled={Boolean(busy)} onClick={onStop}>
        <Square size={15} fill="currentColor" /> Stop recording
      </button>
      <small>Microphone + system audio / 30-minute limit</small>
    </section>
  );
}
