const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MeetingStore, canApprove } = require("../../frontend/main/models/meetingStore.cjs");

const transcript = "Taylor: I will send the report by Friday.";
const item = {
  title: "Send report",
  owner: "Taylor",
  deadline: "Friday",
  classification: "CONFIRMED",
  quote: "I will send the report by Friday.",
};

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "team6-store-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new MeetingStore(root);
}

test("approval requires verified evidence, owner and deadline", () => {
  assert.equal(canApprove(item, transcript), true);
  for (const change of [
    { owner: "" },
    { deadline: "" },
    { quote: "invented" },
    { quote: "" },
    { classification: "NEEDS_INFO" },
  ]) {
    assert.equal(canApprove({ ...item, ...change }, transcript), false);
  }
});

test("history survives reload and keeps meetings separate", (context) => {
  const store = fixture(context);
  const first = store.create("First", transcript);
  store.create("Second", "Other meeting");
  store.setAnalysis(first.id, [item]);
  store.decide(first.id, "0", "approved");
  const reopened = new MeetingStore(store.root);
  assert.equal(reopened.list().length, 2);
  assert.equal(reopened.export(first.id).items.length, 1);
  store.update(first.id, "Renamed", "Changed source");
  assert.equal(store.export(first.id).items.length, 0);
  assert.equal(store.read(first.id).analyzed, false);
});

test("cannot forge eligibility or escape the meeting directory", (context) => {
  const store = fixture(context);
  const meeting = store.create("Review", transcript);
  store.setAnalysis(meeting.id, [{ ...item, quote: "fake", eligible: true }]);
  assert.throws(
    () => store.decide(meeting.id, "0", "approved"),
    /source-verified/,
  );
  assert.throws(() => store.read("../secrets"), /Invalid meeting/);
  assert.throws(
    () => store.decide(meeting.id, "0", "whatever"),
    /Invalid decision/,
  );
});

test("delete removes only the selected meeting and its audio", (context) => {
  const store = fixture(context);
  const meeting = store.create("Recording");
  const other = store.create("Keep");
  fs.writeFileSync(store.audioFile(meeting.id), "audio");
  store.delete(meeting.id);
  assert.equal(fs.existsSync(store.audioFile(meeting.id)), false);
  assert.equal(store.read(other.id).title, "Keep");
});
