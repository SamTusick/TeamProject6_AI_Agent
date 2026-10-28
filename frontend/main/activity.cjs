// Tracks the active recording and which meetings have long-running work in flight.
function createActivity() {
  const busy = new Set();
  let recording = null;

  function ensureAvailable(id) {
    if (busy.has(id) || recording?.id === id)
      throw new Error(
        "This meeting is busy. Finish the current operation first.",
      );
  }

  async function exclusive(id, work) {
    ensureAvailable(id);
    busy.add(id);
    try {
      return await work();
    } finally {
      busy.delete(id);
    }
  }

  return {
    ensureAvailable,
    exclusive,
    getRecording: () => recording,
    setRecording: (value) => {
      recording = value;
    },
    isWorking: () => Boolean(recording) || busy.size > 0,
  };
}

module.exports = { createActivity };
