import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  AudioLines,
  Download,
  FileText,
  FolderOpen,
  Headphones,
  LoaderCircle,
  Mic,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Square,
  SquareKanban,
  Trash2,
  X,
} from "lucide-react";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./style.css";
import { startRecorder } from "./recorder.js";
import { toWavChunks } from "./wav.js";
import { IconButton } from "./IconButton.jsx";
import { findQuote, revealRange } from "./evidence.js";
import { TranscriptPane } from "./TranscriptPane.jsx";
import { ReviewPane } from "./ReviewPane.jsx";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { Landing } from "./Landing.jsx";
import owlUrl from "./assets/owl-avatar.jpg";

const api = window.meetings;

function Modal({ title, close, error, busy, children }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <IconButton label="Close dialog" onClick={close}>
          <X size={19} />
        </IconButton>
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {busy && (
        <div className="banner processing" role="status">
          <LoaderCircle size={16} className="spin" />
          {busy}...
        </div>
      )}
      {children}
    </dialog>
  );
}

function App() {
  const [meetings, setMeetings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newTranscript, setNewTranscript] = useState("");
  const [settings, setSettings] = useState(null);
  const [jira, setJira] = useState(null);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [recording, setRecording] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [audioUrl, setAudioUrl] = useState("");
  const [consents, setConsents] = useState([]);
  const [started, setStarted] = useState(false);
  const controller = useRef(null);
  const canvas = useRef(null);
  const transcriptRef = useRef(null);
  const meeting = meetings.find((candidate) => candidate.id === selected);
  const locked = Boolean(busy || recording);

  function upsert(value) {
    if (!value) return;
    setMeetings((previous) =>
      [
        value,
        ...previous.filter((candidate) => candidate.id !== value.id),
      ].sort((first, second) =>
        second.createdAt.localeCompare(first.createdAt),
      ),
    );
    setSelected(value.id);
  }

  // Jira status only reads .env; a failure just leaves the button disabled.
  function refreshJira() {
    api.jiraStatus().then(setJira, () =>
      setJira({ configured: false, missing: [], serverInstalled: false }),
    );
  }

  async function task(label, action) {
    setError("");
    setNotice("");
    setBusy(label);
    try {
      return await action();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    void task("Opening workspace", async () => {
      const [history, connection] = await Promise.all([
        api.list(),
        api.settings(),
      ]);
      setMeetings(history);
      setSettings(connection);
      if (history.length) setSelected(history[0].id);
    });
    refreshJira();
  }, []);

  // Confirmations requested by the main process, shown one at a time.
  useEffect(() => {
    const stopConsent = api.onConsent((request) =>
      setConsents((previous) => [...previous, request]),
    );
    const stopNotice = api.onNotice((message) => setNotice(message));
    return () => {
      stopConsent();
      stopNotice();
    };
  }, []);

  function answerConsent(request, approved) {
    setConsents((previous) =>
      previous.filter((value) => value.id !== request.id),
    );
    api.answerConsent(request.id, approved).catch(() => {});
  }

  useEffect(() => {
    setEditing(false);
    setFilter("all");
    setAudioUrl("");
  }, [selected]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - recording.started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  async function beginRecording() {
    await task("Preparing recording", async () => {
      const created = await api.beginRecording(
        newTitle || `Meeting ${new Date().toLocaleString()}`,
      );
      if (!created) return;
      flushSync(() => {
        setModal(null);
        upsert(created);
        setElapsed(0);
        setRecording({ id: created.id, started: Date.now() });
      });
      try {
        controller.current = await startRecorder({
          canvas: canvas.current,
          onChunk: (chunk) => api.appendRecording(created.id, chunk),
          onError: (failure) => setError(failure.message),
          onLimit: () =>
            setNotice(
              "Recording stopped at the session limit. Start another meeting to continue.",
            ),
          onStop: async () => {
            setBusy("Saving recording");
            try {
              upsert(await api.finishRecording(created.id));
            } catch (failure) {
              setError(failure.message);
            } finally {
              setRecording(null);
              controller.current = null;
              setBusy("");
            }
          },
        });
      } catch (failure) {
        await api.finishRecording(created.id);
        setRecording(null);
        throw new Error(`Could not record: ${failure.message}`);
      }
    });
  }

  function showEvidence(item) {
    const area = transcriptRef.current;
    if (!area) return;
    const range = findQuote(item.quote, area.value);
    if (range) revealRange(area, range);
    else setNotice("Couldn't find that quote in the transcript.");
  }

  const eligible = meeting?.items.filter((item) => item.eligible) || [];
  const approved =
    meeting?.items.filter((item) => item.decision === "approved") || [];
  const jiraPending = approved.filter((item) => item.eligible && !item.jiraKey);
  const visibleItems =
    meeting?.items.filter(
      (item) =>
        filter === "all" ||
        (filter === "eligible" && item.eligible) ||
        (filter === "questions" && item.classification === "NEEDS_INFO"),
    ) || [];

  if (!started) return <Landing onStart={() => setStarted(true)} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          title="Back to home"
          aria-label="Minutely home"
          disabled={locked || editing}
          onClick={() => setStarted(false)}
        >
          <img className="brand-mark" src={owlUrl} alt="" />
          <span>
            <strong>Minutely</strong>
            <span>MEETING WORKSPACE</span>
          </span>
        </button>
        <button
          className="primary new-meeting"
          disabled={locked}
          onClick={() => {
            setNewTitle("");
            setNewTranscript("");
            setModal("new");
          }}
        >
          <Plus size={18} /> New meeting
        </button>
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Search meetings"
            placeholder="Search meetings"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="section-label">
          YOUR MEETINGS <span>{meetings.length}</span>
        </div>
        <nav className="meeting-list" aria-label="Meetings">
          {meetings
            .filter((value) =>
              value.title.toLowerCase().includes(search.toLowerCase()),
            )
            .map((value) => (
              <button
                key={value.id}
                disabled={locked || editing}
                className={`meeting-link ${selected === value.id ? "selected" : ""}`}
                onClick={() => setSelected(value.id)}
              >
                {value.source === "Recording" ? (
                  <Headphones size={17} />
                ) : (
                  <FileText size={17} />
                )}
                <span>
                  <strong>{value.title}</strong>
                  <small>
                    {new Date(value.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    /{" "}
                    {
                      value.items.filter((item) => item.decision === "approved")
                        .length
                    }{" "}
                    approved
                  </small>
                </span>
              </button>
            ))}
          {!meetings.length && <p className="muted small">No meetings yet.</p>}
          {meetings.length > 0 &&
            !meetings.some((value) =>
              value.title.toLowerCase().includes(search.toLowerCase()),
            ) && <p className="muted small">No matching meetings.</p>}
        </nav>
        <div className="sidebar-footer">
          <span>
            <span className="status-dot" /> Local workspace
          </span>
          <button
            disabled={locked}
            onClick={() => {
              setKey("");
              setClearKey(false);
              setModal("settings");
              refreshJira();
            }}
          >
            <Settings size={17} /> Connections
          </button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <span>
            WORKSPACE / <b>MEETINGS</b>
          </span>
          <span className="privacy">
            <ShieldCheck size={15} /> Human-approved decisions
          </span>
        </header>
        <div className="messages" aria-live="polite">
          {error && !modal && (
            <div className="banner error" role="alert">
              {error}
              <IconButton label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </IconButton>
            </div>
          )}
          {notice && (
            <div className="banner notice">
              {notice}
              <IconButton label="Dismiss notice" onClick={() => setNotice("")}>
                <X size={16} />
              </IconButton>
            </div>
          )}
          {busy && (
            <div className="banner processing">
              <LoaderCircle size={16} className="spin" />
              {busy}...
            </div>
          )}
        </div>

        {recording && (
          <section className="recording-band" aria-label="Active recording">
            <div>
              <span className="recording-dot" /> <strong>Recording</strong>
              <span className="timer">
                {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
                {String(elapsed % 60).padStart(2, "0")}
              </span>
            </div>
            <canvas
              ref={canvas}
              width="480"
              height="56"
              aria-label="Live mixed audio levels"
            />
            <button
              className="stop"
              disabled={Boolean(busy)}
              onClick={() => {
                setBusy("Stopping recording");
                controller.current?.stop();
              }}
            >
              <Square size={15} fill="currentColor" /> Stop recording
            </button>
            <small>Microphone + system audio / 30-minute limit</small>
          </section>
        )}

        {!meeting ? (
          <section className="empty-workspace">
            <img className="empty-symbol" src={owlUrl} alt="" />
            <h1>Your meeting workspace</h1>
            <p className="empty-lede">
              Record a meeting or bring in a transcript, and Minutely will pull
              out the commitments for you to review.
            </p>
            <div className="empty-actions">
              <button
                className="primary"
                disabled={locked}
                onClick={() => {
                  setNewTitle("");
                  setModal("record");
                }}
              >
                <Mic size={18} /> Record a meeting
              </button>
              <button
                disabled={locked}
                onClick={() =>
                  task("Importing transcript", async () =>
                    upsert(await api.importTranscript()),
                  )
                }
              >
                <FolderOpen size={18} /> Import transcript
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="meeting-heading">
              <div>
                <div className="eyebrow">
                  {meeting.source} /{" "}
                  {new Date(meeting.createdAt).toLocaleDateString(undefined, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
                <h1>{meeting.title}</h1>
              </div>
              <div className="toolbar">
                <button
                  disabled={locked || !approved.length || editing}
                  onClick={() =>
                    task("Exporting approvals", async () => {
                      if (await api.export(meeting.id))
                        setNotice("Approved action items exported.");
                    })
                  }
                >
                  <Download size={17} /> Export{" "}
                  {approved.length > 0 && `(${approved.length})`}
                </button>
                <button
                  disabled={
                    locked || !jiraPending.length || editing || !jira?.configured
                  }
                  title={
                    !jira?.configured
                      ? "Set up Jira in Connections first"
                      : jiraPending.length
                        ? `Create ${jiraPending.length} Jira issue(s) in ${jira.project}`
                        : "Approve items to send them to Jira"
                  }
                  onClick={() =>
                    task("Creating Jira issues", async () => {
                      const value = await api.sendToJira(meeting.id);
                      if (!value) return;
                      upsert(value);
                      const sent = value.items.filter(
                        (item) => item.jiraKey && jiraPending.some((p) => p.id === item.id),
                      );
                      const failed = value.items.filter(
                        (item) => item.jiraError && jiraPending.some((p) => p.id === item.id),
                      );
                      if (failed.length)
                        setError(
                          `${failed.length} item(s) were not created in Jira: ${failed[0].jiraError}`,
                        );
                      if (sent.length)
                        setNotice(
                          `Created in Jira: ${sent.map((item) => item.jiraKey).join(", ")}`,
                        );
                    })
                  }
                >
                  <Send size={17} /> Send to Jira{" "}
                  {jiraPending.length > 0 && `(${jiraPending.length})`}
                </button>
                <IconButton
                  label="Delete meeting"
                  disabled={locked || editing}
                  onClick={() =>
                    task("Deleting meeting", async () => {
                      if (await api.delete(meeting.id)) {
                        setMeetings((previous) =>
                          previous.filter((value) => value.id !== meeting.id),
                        );
                        setSelected(null);
                      }
                    })
                  }
                >
                  <Trash2 size={18} />
                </IconButton>
              </div>
            </section>
            <section className="metrics">
              <div>
                <strong>
                  {meeting.items.length.toString().padStart(2, "0")}
                </strong>
                <span>Candidate items</span>
              </div>
              <div>
                <strong>{eligible.length.toString().padStart(2, "0")}</strong>
                <span>Eligible for approval</span>
              </div>
              <div>
                <strong className="green">
                  {approved.length.toString().padStart(2, "0")}
                </strong>
                <span>Approved</span>
              </div>
            </section>
            <div className="workspace-grid" key={meeting.id}>
              <TranscriptPane
                meeting={meeting}
                locked={locked}
                editing={editing}
                showAudioTools={Boolean(meeting.audio && !recording)}
                audioUrl={audioUrl}
                hasWisprKey={Boolean(settings?.hasWisprKey)}
                title={title}
                draft={draft}
                transcriptRef={transcriptRef}
                onEdit={() => {
                  setTitle(meeting.title);
                  setDraft(meeting.transcript);
                  setEditing(true);
                }}
                onCancel={() => setEditing(false)}
                onSave={() =>
                  task("Saving transcript", async () => {
                    upsert(await api.update(meeting.id, title, draft));
                    setEditing(false);
                  })
                }
                onTitleChange={setTitle}
                onDraftChange={setDraft}
                onLoadAudio={() =>
                  task("Loading recording", async () => {
                    const bytes = await api.audio(meeting.id);
                    if (bytes)
                      setAudioUrl(
                        URL.createObjectURL(
                          new Blob([bytes], { type: "audio/webm" }),
                        ),
                      );
                  })
                }
                onTranscribeLocal={() =>
                  task("Running local Whisper transcription", async () => {
                    const result = await api.transcribe(meeting.id);
                    if (result) {
                      upsert(result);
                      setNotice("Transcript ready for review.");
                    }
                  })
                }
                onTranscribeWispr={() =>
                  task("Transcribing with Wispr Flow", async () => {
                    const bytes = await api.audio(meeting.id);
                    if (!bytes) throw new Error("This meeting has no recording.");
                    const chunks = await toWavChunks(bytes);
                    const result = await api.transcribeWispr(meeting.id, chunks);
                    if (result) {
                      upsert(result);
                      setNotice("Wispr Flow transcript ready for review.");
                    }
                  })
                }
              />
              <ReviewPane
                meeting={meeting}
                items={visibleItems}
                filter={filter}
                locked={locked}
                editing={editing}
                onFilterChange={setFilter}
                onAnalyze={() =>
                  task("Analyzing transcript", async () =>
                    upsert(await api.analyze(meeting.id)),
                  )
                }
                onDecide={(item, decision) =>
                  task(
                    decision === "pending"
                      ? "Updating decision"
                      : decision === "approved"
                        ? "Saving approval"
                        : "Saving decision",
                    async () =>
                      upsert(await api.decide(meeting.id, item.id, decision)),
                  )
                }
                onShowEvidence={showEvidence}
              />
            </div>
          </>
        )}
        <footer className="main-footer">
          <span>Minutely / desktop preview</span>
          <span>Local speech / Whisper base</span>
        </footer>
      </main>

      {consents[0] && (
        <ConfirmDialog
          key={consents[0].id}
          request={consents[0]}
          onAnswer={(approved) => answerConsent(consents[0], approved)}
        />
      )}

      {modal === "new" && (
        <Modal
          title="New meeting"
          error={error}
          busy={busy}
          close={() => !busy && setModal(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              task("Creating meeting", async () => {
                upsert(await api.create(newTitle, newTranscript));
                setModal(null);
              });
            }}
          >
            <label>
              Meeting title
              <input
                autoFocus
                required
                maxLength={160}
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Weekly project sync"
              />
            </label>
            <label>
              Transcript
              <textarea
                rows={7}
                maxLength={100000}
                value={newTranscript}
                onChange={(event) => setNewTranscript(event.target.value)}
                placeholder="Paste meeting transcript"
              />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  task("Importing transcript", async () => {
                    const imported = await api.importTranscript();
                    if (imported) {
                      upsert(imported);
                      setModal(null);
                    }
                  })
                }
              >
                <FolderOpen size={17} /> Import .txt
              </button>
              <button className="primary" disabled={locked || !newTitle.trim()}>
                Create meeting
              </button>
            </div>
            <button
              className="record-alternative"
              type="button"
              disabled={locked}
              onClick={() => setModal("record")}
            >
              <Mic size={17} /> Record a meeting instead
            </button>
          </form>
        </Modal>
      )}
      {modal === "record" && (
        <Modal
          title="Record meeting"
          error={error}
          busy={busy}
          close={() => !busy && setModal(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              beginRecording();
            }}
          >
            <label>
              Meeting title
              <input
                autoFocus
                required
                value={newTitle}
                maxLength={160}
                onChange={(event) => setNewTitle(event.target.value)}
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
              Participant permission required. Other apps and notification
              sounds may also be captured. Use headphones to reduce echo.
            </div>
            <div className="dialog-actions">
              <span className="small muted">30 minutes / 24 MB maximum</span>
              <button className="primary" disabled={locked || !newTitle.trim()}>
                <Mic size={17} /> Start recording
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "settings" && settings && (
        <Modal
          title="Connections"
          error={error}
          busy={busy}
          close={() => !busy && setModal(null)}
        >
          <div className="connection-info">
            <ShieldCheck size={20} />
            <div>
              <strong>Action analysis / NRP</strong>
              <span>Project .env configuration</span>
            </div>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              task("Saving Wispr Flow connection", async () => {
                setSettings(
                  await api.saveWisprSettings({
                    key,
                    clearKey,
                  }),
                );
                setKey("");
                setClearKey(false);
                setModal(null);
                setNotice("Wispr Flow connection saved.");
              });
            }}
          >
            <div className="connection-heading">
              <AudioLines size={21} />
              <h3>Wispr Flow transcription</h3>
              <span className="badge">
                {settings.hasWisprKey ? "Key saved" : "Not configured"}
              </span>
            </div>
            <label>
              Wispr Flow API key
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder={
                  settings.hasWisprKey
                    ? "Saved key unchanged unless replaced"
                    : "Enter Wispr Flow API key"
                }
              />
            </label>
            {settings.hasWisprKey && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={clearKey}
                  onChange={(event) => setClearKey(event.target.checked)}
                />{" "}
                Remove saved key
              </label>
            )}
            <div className="privacy-notice">
              Recordings are uploaded to Wispr Flow only when you choose
              Transcribe with Wispr Flow. It tidies speech (drops filler words,
              applies self-corrections), so text is not strictly verbatim.
            </div>
            <div className="dialog-actions">
              <span className="small muted">
                {settings.encryptionAvailable
                  ? "OS-protected credential storage"
                  : "Credential encryption unavailable"}
              </span>
              <button
                className="primary"
                disabled={locked || (!key && !clearKey)}
              >
                Save Wispr Flow
              </button>
            </div>
          </form>
          <section className="jira-connection">
            <div className="connection-heading">
              <SquareKanban size={21} />
              <h3>Jira task assignment</h3>
              <span className={`badge ${jira?.configured ? "CONFIRMED" : ""}`}>
                {jira?.configured ? `Connected - ${jira.project}` : "Not configured"}
              </span>
            </div>
            {jira?.configured ? (
              <p className="small muted">
                Approved items are created in {jira.project} on {jira.site} and
                assigned to their owners. Settings live in the project .env.
              </p>
            ) : (
              <div className="privacy-notice">
                {jira?.missing?.length > 0 && (
                  <>
                    Add these to the project <code>.env</code>, then restart the
                    app: <strong>{jira.missing.join(", ")}</strong>.{" "}
                  </>
                )}
                {jira && !jira.serverInstalled && (
                  <>
                    Install the Jira MCP server:{" "}
                    <code>python -m venv .venv-jira</code> then{" "}
                    <code>.venv-jira/Scripts/pip install mcp-atlassian==0.24.6</code>.
                  </>
                )}{" "}
                See the README section "Jira task assignment" for where to
                find each value.
              </div>
            )}
          </section>
        </Modal>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
