export async function startRecorder({
  onChunk,
  onStop,
  onError,
  onLimit,
  canvas,
}) {
  const streams = [];
  let context;
  let animation;
  let limitTimer;
  let recorder;
  let pending = Promise.resolve();
  let bytes = 0;
  let closed = false;

  const cleanup = () => {
    cancelAnimationFrame(animation);
    clearTimeout(limitTimer);
    streams.forEach((stream) =>
      stream.getTracks().forEach((track) => track.stop()),
    );
    if (context && context.state !== "closed") void context.close();
  };
  const stop = () => {
    if (closed) return;
    closed = true;
    if (recorder?.state === "recording") recorder.stop();
    else cleanup();
  };

  try {
    const desktop = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    streams.push(desktop);
    if (!desktop.getAudioTracks().length)
      throw new Error(
        "Windows did not supply system audio. Check the active playback device and try again.",
      );
    const microphone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    streams.push(microphone);
    context = new AudioContext();
    await context.resume();
    const destination = context.createMediaStreamDestination();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    const compressor = context.createDynamicsCompressor();
    for (const stream of streams)
      context
        .createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
        .connect(compressor);
    compressor.connect(destination);
    compressor.connect(analyser);
    recorder = new MediaRecorder(destination.stream, {
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond: 64_000,
    });
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      bytes += event.data.size;
      pending = pending
        .then(async () =>
          onChunk(new Uint8Array(await event.data.arrayBuffer())),
        )
        .catch((error) => {
          onError(error);
          stop();
        });
      if (bytes > 22_000_000) {
        onLimit();
        stop();
      }
    };
    recorder.onerror = () => {
      onError(
        new Error(
          "Audio recording was interrupted. Partial audio has been kept.",
        ),
      );
      stop();
    };
    recorder.onstop = async () => {
      cleanup();
      await pending;
      onStop();
    };
    for (const stream of streams) {
      stream.getTracks().forEach((track) =>
        track.addEventListener("ended", () => {
          if (!closed) {
            onError(
              new Error("An audio source disconnected. Recording has stopped."),
            );
            stop();
          }
        }),
      );
    }
    const samples = new Uint8Array(analyser.frequencyBinCount);
    const barColor = getComputedStyle(canvas)
      .getPropertyValue("--color-primary")
      .trim();
    const paint = () => {
      analyser.getByteFrequencyData(samples);
      const drawing = canvas.getContext("2d");
      drawing.clearRect(0, 0, canvas.width, canvas.height);
      drawing.fillStyle = barColor;
      for (let index = 0; index < 64; index++) {
        const height = Math.max(2, (samples[index] / 255) * canvas.height);
        drawing.fillRect(
          (index * canvas.width) / 64,
          (canvas.height - height) / 2,
          canvas.width / 90,
          height,
        );
      }
      animation = requestAnimationFrame(paint);
    };
    recorder.start(1000);
    limitTimer = setTimeout(
      () => {
        onLimit();
        stop();
      },
      30 * 60 * 1000,
    );
    paint();
    return { stop };
  } catch (error) {
    cleanup();
    throw error;
  }
}
