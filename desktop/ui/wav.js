const RATE = 16000;
const CHUNK_SECONDS = 5 * 60;

function encodeWav(samples) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset, value) =>
    [...value].forEach((char, index) =>
      view.setUint8(offset + index, char.charCodeAt(0)),
    );
  tag(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
  });
  return bytes;
}

// Wispr Flow accepts 16 kHz PCM16 WAV up to 6 minutes, so long recordings are split.
export async function toWavChunks(webm) {
  const decoder = new AudioContext();
  let decoded;
  try {
    decoded = await decoder.decodeAudioData(
      webm.buffer.slice(webm.byteOffset, webm.byteOffset + webm.byteLength),
    );
  } finally {
    void decoder.close();
  }
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * RATE),
    RATE,
  );
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const samples = (await offline.startRendering()).getChannelData(0);
  const size = CHUNK_SECONDS * RATE;
  const chunks = [];
  for (let start = 0; start < samples.length; start += size)
    chunks.push(encodeWav(samples.subarray(start, start + size)));
  return chunks;
}
