import { FileText } from "lucide-react";
import { AudioTools } from "./AudioTools.jsx";

export function TranscriptPanel({
  meeting,
  editor,
  locked,
  recording,
  textareaRef,
  audio,
  onTranscribe,
  onSave,
}) {
  const { editing, title, draft } = editor;
  const shown = editing ? draft : meeting.transcript;
  return (
    <section className="transcript-pane">
      <div className="pane-heading">
        <h2>
          <FileText size={18} /> Transcript
        </h2>
        <button
          className="text-button"
          disabled={locked || editing}
          onClick={() => editor.begin(meeting)}
        >
          Edit
        </button>
      </div>
      {meeting.audio && !recording && (
        <AudioTools
          audioUrl={audio.audioUrl}
          locked={locked}
          editing={editing}
          onLoad={audio.load}
          onTranscribe={onTranscribe}
        />
      )}
      {editing && (
        <label className="edit-title">
          Meeting title
          <input
            value={title}
            maxLength={160}
            onChange={(event) => editor.setTitle(event.target.value)}
          />
        </label>
      )}
      <textarea
        ref={textareaRef}
        aria-label="Meeting transcript"
        className="transcript"
        readOnly={!editing}
        placeholder="No transcript yet."
        value={shown}
        maxLength={100000}
        onChange={(event) => editor.setDraft(event.target.value)}
      />
      <div className="transcript-footer">
        {shown.length.toLocaleString()} characters
        {editing && (
          <div className="toolbar">
            <button disabled={locked} onClick={editor.finish}>
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
