import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

export function useAudioPlayback(meetingId, task) {
  const [audioUrl, setAudioUrl] = useState("");

  useEffect(() => {
    setAudioUrl("");
  }, [meetingId]);

  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  const load = () =>
    task("Loading recording", async () => {
      const bytes = await api.audio(meetingId);
      if (bytes)
        setAudioUrl(
          URL.createObjectURL(new Blob([bytes], { type: "audio/webm" })),
        );
    });

  return { audioUrl, load };
}
