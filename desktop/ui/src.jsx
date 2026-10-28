import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  Activity,
  AudioLines,
  Check,
  CheckCheck,
  CircleHelp,
  Download,
  FileText,
  FolderOpen,
  Headphones,
  LoaderCircle,
  Mic,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Square,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./style.css";
import { startRecorder } from "./recorder.js";
import { toWavChunks } from "./wav.js";

const api = window.meetings;
const labels = {
  CONFIRMED: "Confirmed",
  TENTATIVE: "Tentative",
  DISCUSSED_ONLY: "Discussed",
  NEEDS_INFO: "Needs info",
};

function IconButton({ label, children, ...props }) {
  return (
    <button className="icon-button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}

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
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [recording, setRecording] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [audioUrl, setAudioUrl] = useState("");
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
  }, []);

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
    area.focus();
    const escaped = item.quote
      .trim()
      .split(/\s+/u)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    if (!escaped) return;
    const match = new RegExp(escaped, "iu").exec(meeting.transcript);
    if (match)
      area.setSelectionRange(match.index, match.index + match[0].length);
  }

  const eligible = meeting?.items.filter((item) => item.eligible) || [];
  const approved =
    meeting?.items.filter((item) => item.decision === "approved") || [];
  const visibleItems =
    meeting?.items.filter(
      (item) =>
        filter === "all" ||
        (filter === "eligible" && item.eligible) ||
        (filter === "questions" && item.classification === "NEEDS_INFO"),
    ) || [];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <AudioLines size={25} />
          </span>
          <div>
            <strong>Team6</strong>
            <span>MEETING WORKSPACE</span>
          </div>
        </div>
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
            <div className="empty-symbol">
              <AudioLines size={54} strokeWidth={1.2} />
            </div>
            <span className="eyebrow">TEAM6 MEETINGS</span>
            <h1>Your meeting workspace</h1>
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
            <div className="workspace-grid">
              <section className="transcript-pane">
                <div className="pane-heading">
                  <h2>
                    <FileText size={18} /> Transcript
                  </h2>
                  <button
                    className="text-button"
                    disabled={locked || editing}
                    onClick={() => {
                      setTitle(meeting.title);
                      setDraft(meeting.transcript);
                      setEditing(true);
                    }}
                  >
                    Edit
                  </button>
                </div>
                {meeting.audio && !recording && (
                  <div className="audio-tools">
                    {!audioUrl ? (
                      <button
                        disabled={locked}
                        onClick={() =>
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
                      >
                        <Headphones size={16} /> Play recording
                      </button>
                    ) : (
                      <audio controls src={audioUrl} />
                    )}
                    <button
                      disabled={locked || editing}
                      title="Our experimental local speech model; no API key required"
                      onClick={() =>
                        task("Running experimental local transcription", async () => {
                          const result = await api.transcribe(meeting.id);
                          if (result) {
                            upsert(result);
                            setNotice("Transcript ready for review.");
                          }
                        })
                      }
                    >
                      <AudioLines size={16} /> Transcribe locally (experimental)
                    </button>
                    <button
                      disabled={locked || editing || !settings?.hasWisprKey}
                      title={
                        settings?.hasWisprKey
                          ? "Upload the recording to Wispr Flow for transcription"
                          : "Add a Wispr Flow API key in Connections first"
                      }
                      onClick={() =>
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
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                )}
                <textarea
                  ref={transcriptRef}
                  aria-label="Meeting transcript"
                  className="transcript"
                  readOnly={!editing}
                  placeholder="No transcript yet."
                  value={editing ? draft : meeting.transcript}
                  maxLength={100000}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className="transcript-footer">
                  {(editing
                    ? draft
                    : meeting.transcript
                  ).length.toLocaleString()}{" "}
                  characters
                  {editing && (
                    <div className="toolbar">
                      <button
                        disabled={locked}
                        onClick={() => setEditing(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="primary"
                        disabled={locked || !title.trim()}
                        onClick={() =>
                          task("Saving transcript", async () => {
                            upsert(await api.update(meeting.id, title, draft));
                            setEditing(false);
                          })
                        }
                      >
                        Save changes
                      </button>
                    </div>
                  )}
                </div>
              </section>
              <section className="review-pane">
                <div className="pane-heading">
                  <h2>
                    <CheckCheck size={19} /> Action review
                  </h2>
                  <button
                    className="primary"
                    disabled={locked || editing || !meeting.transcript.trim()}
                    onClick={() =>
                      task("Analyzing transcript", async () =>
                        upsert(await api.analyze(meeting.id)),
                      )
                    }
                  >
                    <Activity size={16} />{" "}
                    {meeting.analyzed ? "Reanalyze" : "Analyze"}
                  </button>
                </div>
                <div
                  className="tabs"
                  role="tablist"
                  aria-label="Action filters"
                >
                  {[
                    ["all", "All items"],
                    ["eligible", "Eligible"],
                    ["questions", "Needs info"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      role="tab"
                      aria-selected={filter === value}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="items">
                  {!visibleItems.length && (
                    <div className="empty-items">
                      <CircleHelp size={28} />
                      <h3>
                        {meeting.analyzed
                          ? "No matching items"
                          : "Awaiting analysis"}
                      </h3>
                    </div>
                  )}
                  {visibleItems.map((item) => (
                    <article
                      className={`action-item ${item.decision}`}
                      key={item.id}
                    >
                      <div className="item-meta">
                        <span className={`badge ${item.classification}`}>
                          {labels[item.classification] || item.classification}
                        </span>
                        <span
                          className={item.verified ? "verified" : "unverified"}
                        >
                          {item.verified ? (
                            <ShieldCheck size={14} />
                          ) : (
                            <CircleHelp size={14} />
                          )}
                          {item.verified
                            ? "Quote matched"
                            : "Quote not verified"}
                        </span>
                      </div>
                      <h3>{item.title}</h3>
                      <div className="ownership">
                        <span>{item.owner || "Owner missing"}</span>
                        <span>{item.deadline || "Deadline missing"}</span>
                      </div>
                      <button
                        className="quote"
                        onClick={() => showEvidence(item)}
                        title="Find source quote"
                      >
                        "{item.quote || "No source quote"}"
                      </button>
                      <p className="reasoning">{item.reasoning}</p>
                      {item.clarifying_question && (
                        <p className="question">
                          <CircleHelp size={16} />
                          {item.clarifying_question}
                        </p>
                      )}
                      {!item.eligible && (
                        <p className="small muted">{item.reason}</p>
                      )}
                      <div className="decision-row">
                        <span className="small">
                          {item.decision === "pending"
                            ? "Not reviewed"
                            : item.decision === "approved"
                              ? "Approved"
                              : "Rejected"}
                        </span>
                        <div className="toolbar">
                          {item.decision !== "pending" ? (
                            <IconButton
                              label={`Undo decision: ${item.title}`}
                              disabled={locked || editing}
                              onClick={() =>
                                task("Updating decision", async () =>
                                  upsert(
                                    await api.decide(
                                      meeting.id,
                                      item.id,
                                      "pending",
                                    ),
                                  ),
                                )
                              }
                            >
                              <Undo2 size={17} />
                            </IconButton>
                          ) : (
                            <>
                              <IconButton
                                label={`Reject: ${item.title}`}
                                disabled={locked || editing}
                                onClick={() =>
                                  task("Saving decision", async () =>
                                    upsert(
                                      await api.decide(
                                        meeting.id,
                                        item.id,
                                        "rejected",
                                      ),
                                    ),
                                  )
                                }
                              >
                                <X size={17} />
                              </IconButton>
                              <button
                                className="approve"
                                disabled={locked || editing || !item.eligible}
                                onClick={() =>
                                  task("Saving approval", async () =>
                                    upsert(
                                      await api.decide(
                                        meeting.id,
                                        item.id,
                                        "approved",
                                      ),
                                    ),
                                  )
                                }
                              >
                                <Check size={16} /> Approve
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
        <footer className="main-footer">
          <span>TEAM6 / DESKTOP PREVIEW</span>
          <span>Local speech / Experimental model</span>
        </footer>
      </main>

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
        </Modal>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
