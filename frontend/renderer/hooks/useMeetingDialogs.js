import { useState } from "react";

export function useMeetingDialogs() {
  const [modal, setModal] = useState(null);
  const [newTitle, setNewTitle] = useState("");
  const [newTranscript, setNewTranscript] = useState("");

  return {
    modal,
    newTitle,
    newTranscript,
    setNewTitle,
    setNewTranscript,
    close: () => setModal(null),
    openNew() {
      setNewTitle("");
      setNewTranscript("");
      setModal("new");
    },
    openRecord() {
      setNewTitle("");
      setModal("record");
    },
    switchToRecord: () => setModal("record"),
  };
}
