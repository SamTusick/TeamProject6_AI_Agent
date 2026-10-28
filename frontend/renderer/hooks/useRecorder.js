import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api } from "../lib/api.js";
import { startRecorder } from "../lib/recorder.js";

export function useRecorder({ task, upsert, setBusy, setError, setNotice }) {
  const [recording, setRecording] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const controller = useRef(null);
  const canvas = useRef(null);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - recording.started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [recording]);

  const begin = (title, closeDialog) =>
    task("Preparing recording", async () => {
      const created = await api.beginRecording(
        title || `Meeting ${new Date().toLocaleString()}`,
      );
      if (!created) return;
      flushSync(() => {
        closeDialog();
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

  function stop() {
    setBusy("Stopping recording");
    controller.current?.stop();
  }

  return { recording, elapsed, canvas, begin, stop };
}
