import React, { useEffect, useRef } from "react";
import { AudioLines, FileText, Headphones, Link2 } from "lucide-react";

export function TranscriptPane({
  meeting,
  locked,
  editing,
  showAudioTools,
  audioUrl,
  hasWisprKey,
  title,
  draft,
  evidence,
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
  const sourceRef = useRef(null);
  useEffect(() => {
    if (!evidence || editing) return;
    const source = sourceRef.current;
    if (!source) return;
    source.focus({ preventScroll: true });
    source.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [evidence, editing]);
  let offset = 0;
  let firstMatch = true;
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
      {!editing && (
        <div className={`transcript-context ${evidence ? "has-evidence" : ""}`} role="status">
          <Link2 size={15} />
          <span>{evidence ? `Source for: ${evidence.title}` : "Select an action to find its source here."}</span>
        </div>
      )}
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
      {editing ? (
        <textarea
          aria-label="Meeting transcript"
          className="transcript"
          placeholder="No transcript yet."
          value={text}
          maxLength={100000}
          onChange={(event) => onDraftChange(event.target.value)}
        />
      ) : (
        <div className="transcript-document" role="region" aria-label="Meeting transcript" tabIndex={0}>
          {!text ? <p className="transcript-placeholder">No transcript yet.</p> : text.split("\n").map((line, index) => {
            const start = offset;
            offset += line.length + 1;
            const from = evidence ? Math.max(0, evidence.start - start) : 0;
            const to = evidence ? Math.min(line.length, evidence.end - start) : 0;
            const matched = to > from;
            const focusTarget = matched && firstMatch;
            if (matched) firstMatch = false;
            return (
              <div className={`transcript-line ${matched ? "highlighted" : ""}`} key={index}>
                <span className="line-number" aria-hidden="true">{index + 1}</span>
                <p>
                  {matched ? (
                    <>
                      {line.slice(0, from)}
                      <mark ref={focusTarget ? sourceRef : undefined} tabIndex={focusTarget ? -1 : undefined}>
                        {line.slice(from, to)}
                      </mark>
                      {line.slice(to)}
                    </>
                  ) : line || "\u00a0"}
                </p>
              </div>
            );
          })}
        </div>
      )}
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
