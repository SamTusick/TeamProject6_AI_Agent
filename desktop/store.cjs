const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const MAX_TEXT = 100_000;
const MAX_AUDIO = 24_000_000;

function text(value, name, limit = MAX_TEXT) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) {
    throw new Error(
      `${name} must contain 1 to ${limit.toLocaleString()} characters.`,
    );
  }
  return value;
}

function validId(id) {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
    throw new Error("Invalid meeting ID.");
  return id;
}

function normalize(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/\s+/gu, " ").trim()
    : "";
}

function canApprove(item, transcript) {
  return (
    item.classification === "CONFIRMED" &&
    Boolean(normalize(item.owner)) &&
    Boolean(normalize(item.deadline)) &&
    Boolean(normalize(item.quote)) &&
    normalize(transcript).includes(normalize(item.quote))
  );
}

function atomicJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

class MeetingStore {
  constructor(root) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }

  file(id) {
    return path.join(this.root, `${validId(id)}.json`);
  }
  audioFile(id) {
    return path.join(this.root, `${validId(id)}.webm`);
  }
  read(id) {
    return JSON.parse(fs.readFileSync(this.file(id), "utf8"));
  }

  list() {
    return fs
      .readdirSync(this.root)
      .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
      .map((name) => this.read(name.slice(0, -5)))
      .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  }

  save(meeting) {
    meeting.updatedAt = new Date().toISOString();
    atomicJson(this.file(meeting.id), meeting);
    return meeting;
  }

  create(title, transcript = "", source = "Transcript") {
    text(title, "Meeting title", 160);
    if (transcript) text(transcript, "Transcript");
    return this.save({
      id: randomUUID(),
      title,
      transcript,
      source,
      createdAt: new Date().toISOString(),
      items: [],
      analyzed: false,
      audio: false,
    });
  }

  update(id, title, transcript) {
    const meeting = this.read(id);
    text(title, "Meeting title", 160);
    if (typeof transcript !== "string" || transcript.length > MAX_TEXT)
      throw new Error("Invalid transcript.");
    if (meeting.transcript !== transcript) {
      meeting.items = [];
      meeting.analyzed = false;
    }
    return this.save({ ...meeting, title, transcript });
  }

  setAnalysis(id, items) {
    if (!Array.isArray(items)) throw new Error("Invalid analysis response.");
    const meeting = this.read(id);
    meeting.items = items.map((item, index) => ({
      ...item,
      id: String(index),
      eligible: canApprove(item, meeting.transcript),
      decision: "pending",
    }));
    meeting.analyzed = true;
    return this.save(meeting);
  }

  decide(id, itemId, decision) {
    if (!["approved", "rejected", "pending"].includes(decision))
      throw new Error("Invalid decision.");
    const meeting = this.read(id);
    const item = meeting.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("Item not found.");
    if (decision === "approved" && !canApprove(item, meeting.transcript)) {
      throw new Error(
        "Only source-verified confirmed items with an owner and deadline can be approved.",
      );
    }
    item.decision = decision;
    return this.save(meeting);
  }

  export(id) {
    const meeting = this.read(id);
    return {
      meeting: meeting.title,
      createdAt: meeting.createdAt,
      items: meeting.items.filter(
        (item) =>
          item.decision === "approved" && canApprove(item, meeting.transcript),
      ),
    };
  }

  delete(id) {
    fs.unlinkSync(this.file(id));
    if (fs.existsSync(this.audioFile(id))) fs.unlinkSync(this.audioFile(id));
  }
}

module.exports = { MeetingStore, atomicJson, canApprove, text, MAX_AUDIO };
