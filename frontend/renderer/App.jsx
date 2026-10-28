import { useRef, useState } from "react";
import { useTask } from "./hooks/useTask.js";
import { useMeetings } from "./hooks/useMeetings.js";
import { useMeetingDialogs } from "./hooks/useMeetingDialogs.js";
import { useTranscriptEditor } from "./hooks/useTranscriptEditor.js";
import { useAudioPlayback } from "./hooks/useAudioPlayback.js";
import { useRecorder } from "./hooks/useRecorder.js";
import { selectQuote } from "./lib/evidence.js";
import { ErrorBanner, NoticeBanner, BusyBanner } from "./components/Banners.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { Topbar, PageFooter } from "./components/PageChrome.jsx";
import { RecordingBand } from "./components/RecordingBand.jsx";
import { EmptyState } from "./components/EmptyState.jsx";
import { MeetingHeader, MeetingStats } from "./components/MeetingHeader.jsx";
import { TranscriptPanel } from "./components/TranscriptPanel.jsx";
import { ActionReview } from "./components/ActionReview.jsx";
import { NewMeetingModal } from "./components/NewMeetingModal.jsx";
import { RecordModal } from "./components/RecordModal.jsx";

export default function App() {
  const { busy, setBusy, error, setError, notice, setNotice, task } = useTask();
  const meetings = useMeetings({ task, setNotice });
  const { meeting, upsert } = meetings;
  const dialogs = useMeetingDialogs();
  const editor = useTranscriptEditor(meetings.selected);
  const audio = useAudioPlayback(meetings.selected, task);
  const recorder = useRecorder({ task, upsert, setBusy, setError, setNotice });
  const [search, setSearch] = useState("");
  const transcriptRef = useRef(null);
  const locked = Boolean(busy || recorder.recording);
  const items = meeting?.items ?? [];
  const approvedCount = items.filter((item) => item.decision === "approved").length;

  async function importFromDialog() {
    if (await meetings.importTranscript()) dialogs.close();
  }

  async function createMeeting() {
    if (await meetings.create(dialogs.newTitle, dialogs.newTranscript))
      dialogs.close();
  }

  async function saveTranscript() {
    if (await meetings.update(meeting.id, editor.title, editor.draft))
      editor.finish();
  }

  return (
    <div className="app-shell">
      <Sidebar
        meetings={meetings.meetings}
        selected={meetings.selected}
        search={search}
        onSearch={setSearch}
        locked={locked}
        editing={editor.editing}
        onSelect={meetings.setSelected}
        onNew={dialogs.openNew}
      />
      <main>
        <Topbar />
        <div className="messages" aria-live="polite">
          {error && !dialogs.modal && (
            <ErrorBanner message={error} onDismiss={() => setError("")} />
          )}
          {notice && (
            <NoticeBanner message={notice} onDismiss={() => setNotice("")} />
          )}
          {busy && <BusyBanner label={busy} />}
        </div>
        {recorder.recording && (
          <RecordingBand
            elapsed={recorder.elapsed}
            canvasRef={recorder.canvas}
            busy={busy}
            onStop={recorder.stop}
          />
        )}
        {!meeting ? (
          <EmptyState
            locked={locked}
            onRecord={dialogs.openRecord}
            onImport={() => meetings.importTranscript()}
          />
        ) : (
          <>
            <MeetingHeader
              meeting={meeting}
              approvedCount={approvedCount}
              locked={locked}
              editing={editor.editing}
              onExport={() => meetings.exportApproved(meeting.id)}
              onDelete={() => meetings.remove(meeting.id)}
            />
            <MeetingStats
              candidates={items.length}
              eligible={items.filter((item) => item.eligible).length}
              approved={approvedCount}
            />
            <div className="workspace-grid">
              <TranscriptPanel
                meeting={meeting}
                editor={editor}
                locked={locked}
                recording={recorder.recording}
                textareaRef={transcriptRef}
                audio={audio}
                onTranscribe={() => meetings.transcribe(meeting.id)}
                onSave={saveTranscript}
              />
              <ActionReview
                key={meeting.id}
                meeting={meeting}
                locked={locked}
                editing={editor.editing}
                onAnalyze={() => meetings.analyze(meeting.id)}
                onDecide={(itemId, decision) =>
                  meetings.decide(meeting.id, itemId, decision)
                }
                onShowEvidence={(item) =>
                  selectQuote(transcriptRef.current, item.quote, meeting.transcript)
                }
              />
            </div>
          </>
        )}
        <PageFooter />
      </main>
      {dialogs.modal === "new" && (
        <NewMeetingModal
          title={dialogs.newTitle}
          transcript={dialogs.newTranscript}
          onTitle={dialogs.setNewTitle}
          onTranscript={dialogs.setNewTranscript}
          error={error}
          busy={busy}
          locked={locked}
          onClose={dialogs.close}
          onSubmit={createMeeting}
          onImport={importFromDialog}
          onRecordInstead={dialogs.switchToRecord}
        />
      )}
      {dialogs.modal === "record" && (
        <RecordModal
          title={dialogs.newTitle}
          onTitle={dialogs.setNewTitle}
          error={error}
          busy={busy}
          locked={locked}
          onClose={dialogs.close}
          onSubmit={() => recorder.begin(dialogs.newTitle, dialogs.close)}
        />
      )}
    </div>
  );
}
