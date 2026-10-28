import { AudioLines, Headphones } from "lucide-react";

export function AudioTools({
  audioUrl,
  locked,
  editing,
  onLoad,
  onTranscribe,
}) {
  return (
    <div className="audio-tools">
      {!audioUrl ? (
        <button disabled={locked} onClick={onLoad}>
          <Headphones size={16} /> Play recording
        </button>
      ) : (
        <audio controls src={audioUrl} />
      )}
      <button
        disabled={locked || editing}
        title="Whisper base running on this device; no API key required"
        onClick={onTranscribe}
      >
        <AudioLines size={16} /> Transcribe locally (Whisper)
      </button>
    </div>
  );
}
