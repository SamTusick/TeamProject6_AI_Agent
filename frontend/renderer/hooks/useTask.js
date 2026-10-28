import { useState } from "react";

export function useTask() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

  return { busy, setBusy, error, setError, notice, setNotice, task };
}
