import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { sortNewestFirst } from "../lib/format.js";

const DECISION_LABELS = {
  pending: "Updating decision",
  rejected: "Saving decision",
  approved: "Saving approval",
};

export function useMeetings({ task, setNotice }) {
  const [meetings, setMeetings] = useState([]);
  const [selected, setSelected] = useState(null);
  const meeting = meetings.find((candidate) => candidate.id === selected);

  function upsert(value) {
    if (!value) return;
    setMeetings((previous) =>
      sortNewestFirst([
        value,
        ...previous.filter((candidate) => candidate.id !== value.id),
      ]),
    );
    setSelected(value.id);
  }

  useEffect(() => {
    void task("Opening workspace", async () => {
      const history = await api.list();
      setMeetings(history);
      if (history.length) setSelected(history[0].id);
    });
  }, []);

  const create = (title, transcript) =>
    task("Creating meeting", async () => {
      upsert(await api.create(title, transcript));
      return true;
    });

  const importTranscript = () =>
    task("Importing transcript", async () => {
      const imported = await api.importTranscript();
      upsert(imported);
      return Boolean(imported);
    });

  const update = (id, title, transcript) =>
    task("Saving transcript", async () => {
      upsert(await api.update(id, title, transcript));
      return true;
    });

  const analyze = (id) =>
    task("Analyzing transcript", async () => upsert(await api.analyze(id)));

  const decide = (id, itemId, decision) =>
    task(DECISION_LABELS[decision], async () =>
      upsert(await api.decide(id, itemId, decision)),
    );

  const exportApproved = (id) =>
    task("Exporting approvals", async () => {
      if (await api.export(id)) setNotice("Approved action items exported.");
    });

  const remove = (id) =>
    task("Deleting meeting", async () => {
      if (await api.delete(id)) {
        setMeetings((previous) =>
          previous.filter((value) => value.id !== id),
        );
        setSelected(null);
      }
    });

  const transcribe = (id) =>
    task("Running local Whisper transcription", async () => {
      const result = await api.transcribe(id);
      if (result) {
        upsert(result);
        setNotice("Transcript ready for review.");
      }
    });

  return {
    meetings,
    selected,
    setSelected,
    meeting,
    upsert,
    create,
    importTranscript,
    update,
    analyze,
    decide,
    exportApproved,
    remove,
    transcribe,
  };
}
