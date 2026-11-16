import React from "react";
import { AudioLines, FileText, Headphones } from "lucide-react";

export function TranscriptPane({
  meeting,
  locked,
  editing,
  showAudioTools,
  audioUrl,
  hasWisprKey,
  title,
  draft,
  transcriptRef,
  onEdit,
  onCancel,
  onSave,
  onTitleChange,
  onDraftChange,
  onLoadAudio,
  onTranscribeLocal,
  onTranscribeWispr,
}) {
  const text = editing ? draft : meeting.transcript;
  return (
    <section className="transcript-pane" aria-label="Transcript">
      <div className="pane-heading">
        <h2>
          <FileText size={18} /> Transcript
        </h2>
        <button
          className="text-button"
          disabled={locked || editing}
          onClick={onEdit}
        >
          Edit
        </button>
      </div>
      {showAudioTools && (
        <div className="audio-tools">
          {!audioUrl ? (
            <button disabled={locked} onClick={onLoadAudio}>
              <Headphones size={16} /> Play recording
            </button>
          ) : (
            <audio controls src={audioUrl} />
          )}
          <button
            disabled={locked || editing}
            title="Whisper base running on this device; no API key required"
            onClick={onTranscribeLocal}
          >
            <AudioLines size={16} /> Transcribe locally (Whisper)
          </button>
          <button
            disabled={locked || editing || !hasWisprKey}
            title={
              hasWisprKey
                ? "Upload the recording to Wispr Flow for transcription"
                : "Add a Wispr Flow API key in Connections first"
            }
            onClick={onTranscribeWispr}
          >
            <AudioLines size={16} /> Transcribe with Wispr Flow
          </button>
        </div>
      )}
      {editing && (
        <label className="edit-title">
          Meeting title
          <input
            value={title}
            maxLength={160}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </label>
      )}
      <textarea
        ref={transcriptRef}
        aria-label="Meeting transcript"
        className="transcript"
        readOnly={!editing}
        placeholder="No transcript yet."
        value={text}
        maxLength={100000}
        onChange={(event) => onDraftChange(event.target.value)}
      />
      <div className="transcript-footer">
        {text.length.toLocaleString()} characters
        {editing && (
          <div className="toolbar">
            <button disabled={locked} onClick={onCancel}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={locked || !title.trim()}
              onClick={onSave}
            >
              Save changes
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
