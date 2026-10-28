import { useEffect, useState } from "react";

export function useTranscriptEditor(meetingId) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setEditing(false);
  }, [meetingId]);

  function begin(meeting) {
    setTitle(meeting.title);
    setDraft(meeting.transcript);
    setEditing(true);
  }

  return {
    editing,
    title,
    draft,
    setTitle,
    setDraft,
    begin,
    finish: () => setEditing(false),
  };
}
