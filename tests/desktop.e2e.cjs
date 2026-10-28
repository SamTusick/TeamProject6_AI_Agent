const { _electron: electron } = require("playwright");
const { expect } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { MeetingStore } = require("../desktop/store.cjs");

async function main() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "team6-e2e-"));
  const artifacts = path.resolve("test-artifacts");
  fs.mkdirSync(artifacts, { recursive: true });
  const store = new MeetingStore(path.join(data, "meetings"));
  const transcript =
    "Morgan: Taylor, can you own the budget report?\nTaylor: Yes, I will have the budget report finished by next Monday.\nMorgan: We also need to update the client documentation.\nCasey: I might be able to look into that, no promises.";
  const meeting = store.create("Weekly project sync", transcript);
  store.setAnalysis(meeting.id, [
    {
      title: "Finish the budget report",
      owner: "Taylor",
      deadline: "next Monday",
      classification: "CONFIRMED",
      quote: "Yes, I will have the budget report finished by next Monday.",
      verified: true,
      reasoning: "Taylor explicitly accepted the task and gave a deadline.",
      reason: "eligible",
    },
    {
      title: "Update client documentation",
      owner: "",
      deadline: "",
      classification: "NEEDS_INFO",
      quote: "We also need to update the client documentation.",
      verified: true,
      clarifying_question:
        "Who owns the documentation update, and when is it due?",
      reasoning: "The task has no named owner or deadline.",
      reason: "classification is NEEDS_INFO, not CONFIRMED",
    },
    {
      title: "Check an unsupported claim",
      owner: "Casey",
      deadline: "Friday",
      classification: "CONFIRMED",
      quote: "I promise to finish everything Friday.",
      verified: false,
      reason: "quote not found in transcript",
    },
  ]);
  let application;
  try {
    application = await electron.launch({
      args: ["."],
      env: { ...process.env, TEAM6_TEST_DATA: data },
    });
    const page = await application.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(
      page.getByRole("heading", { name: "Weekly project sync" }),
    ).toBeVisible();
    assert.equal(await page.evaluate(() => typeof window.require), "undefined");
    const preferences = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    );
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
    const badApproval = await page.evaluate(async (id) => {
      try {
        await window.meetings.decide(id, "2", "approved");
        return "unexpected approval";
      } catch (error) {
        return error.message;
      }
    }, meeting.id);
    assert.match(badApproval, /source-verified/);
    const items = page.locator(".action-item");
    await expect(
      items.nth(0).getByRole("button", { name: "Approve", exact: true }),
    ).toBeEnabled();
    await expect(
      items.nth(1).getByRole("button", { name: "Approve", exact: true }),
    ).toBeDisabled();
    await expect(
      items.nth(2).getByRole("button", { name: "Approve", exact: true }),
    ).toBeDisabled();
    await items
      .nth(0)
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    await expect(
      items.nth(0).getByText("Approved", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page
        .locator(".action-item")
        .first()
        .getByText("Approved", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(artifacts, "desktop-review.png"),
      fullPage: true,
    });
    console.log(
      "PASS: isolated renderer, evidence enforcement, and persisted approvals",
    );

    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await page
      .getByLabel("Wispr Flow API key", { exact: true })
      .fill("test-only-not-a-real-key");
    await page
      .getByRole("button", { name: "Save Wispr Flow", exact: true })
      .click();
    await expect(
      page.getByText("Wispr Flow connection saved.", { exact: true }),
    ).toBeVisible();
    const settings = await page.evaluate(() => window.meetings.settings());
    assert.equal(settings.hasWisprKey, true);
    assert.equal("key" in settings, false);
    assert.equal(
      fs
        .readFileSync(path.join(data, "speech-settings.json"), "utf8")
        .includes("test-only-not-a-real-key"),
      false,
    );
    console.log(
      "PASS: settings store encrypted credentials and never return saved keys",
    );

    await application.evaluate(({ dialog }, directory) => {
      dialog.showMessageBox = async () => ({ response: 1 });
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: `${directory}/approved.json`,
      });
    }, data);
    await page.getByRole("button", { name: "Export (1)", exact: true }).click();
    await expect(
      page.getByText("Approved action items exported.", { exact: true }),
    ).toBeVisible();
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(data, "approved.json"), "utf8"))
        .items.length,
      1,
    );
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Meeting transcript", exact: true })
      .fill("Updated source transcript.");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Awaiting analysis" }),
    ).toBeVisible();
    assert.equal(store.export(meeting.id).items.length, 0);
    console.log(
      "PASS: export includes approvals only; source edits invalidate prior decisions",
    );

    await page
      .getByRole("button", { name: "New meeting", exact: true })
      .click();
    await page
      .getByLabel("Meeting title", { exact: true })
      .fill("Synthetic audio test");
    await page
      .getByRole("button", { name: "Record a meeting instead" })
      .click();
    await page.evaluate(() => {
      const context = new AudioContext();
      const createAudio = (frequency) => {
        const tone = context.createOscillator();
        tone.frequency.value = frequency;
        const destination = context.createMediaStreamDestination();
        tone.connect(destination);
        tone.start();
        return destination.stream;
      };
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        canvas.getContext("2d").fillRect(0, 0, 64, 64);
        return new MediaStream([
          ...canvas.captureStream(5).getTracks(),
          ...createAudio(440).getTracks(),
        ]);
      };
      navigator.mediaDevices.getUserMedia = async () => createAudio(660);
    });
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .click();
    await expect(page.getByText("Recording", { exact: true })).toBeVisible();
    await expect
      .poll(
        () => {
          const recorded = store
            .list()
            .find((value) => value.title === "Synthetic audio test");
          return recorded ? fs.statSync(store.audioFile(recorded.id)).size : 0;
        },
        { timeout: 15000 },
      )
      .toBeGreaterThan(1000);
    const pixels = await page.locator("canvas").evaluate((canvas) => {
      const data = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let opaque = 0;
      for (let index = 3; index < data.length; index += 4)
        if (data[index] > 0) opaque++;
      return opaque;
    });
    assert.ok(pixels > 100, "Waveform must contain visible audio level bars");
    await page.screenshot({
      path: path.join(artifacts, "desktop-recording.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Stop recording", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Play recording" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Play recording" }).click();
    await expect(page.locator("audio")).toBeVisible();
    await expect
      .poll(() => page.locator("audio").evaluate((audio) => audio.readyState))
      .toBeGreaterThan(0);
    console.log(
      "PASS: synthetic microphone/system recording, visible audio levels, saved WebM playback",
    );

    await page.evaluate(() => window.meetings.saveWisprSettings({ clearKey: true }));
    assert.equal((await page.evaluate(() => window.meetings.settings())).hasWisprKey, false);
    const recordedMeeting = store.list().find((value) => value.title === "Synthetic audio test");
    await page.evaluate(({ id }) => window.meetings.update(id, "Synthetic audio test", "Keep this transcript."), recordedMeeting);
    const beforeTranscription = store.read(recordedMeeting.id);
    await page.reload();
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_window, options) => {
        if (!options.message.includes("local transcription")) throw new Error("Expected local transcription consent");
        return { response: 1 };
      };
    });
    await page.getByRole("button", { name: "Transcribe locally (experimental)", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("returned no words", { timeout: 180000 });
    assert.deepEqual(store.read(recordedMeeting.id), beforeTranscription);
    await expect(page.getByRole("button", { name: "Transcribe locally (experimental)", exact: true })).toBeEnabled();
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    console.log("PASS: real local checkpoint runs without a speech key; blank output preserves transcript and releases busy state");

    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(520, 820),
    );
    await expect
      .poll(() => page.evaluate(() => window.innerWidth))
      .toBeLessThan(600);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(
      overflow,
      false,
      "Narrow desktop layout must not overflow horizontally",
    );
    await page.screenshot({
      path: path.join(artifacts, "narrow-workspace.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Delete meeting", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your meeting workspace" }),
    ).toBeVisible();
    assert.ok(
      !store.list().some((value) => value.title === "Synthetic audio test"),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: narrow layout, meeting deletion, and zero renderer exceptions",
    );
  } catch (error) {
    if (application) {
      const page = await application.firstWindow();
      console.error(
        "UI alerts:",
        await page.getByRole("alert").allTextContents(),
      );
      console.error(
        "UI status:",
        await page.locator(".processing").allTextContents(),
      );
      await page.screenshot({
        path: path.join(artifacts, "failure.png"),
        fullPage: true,
      });
    }
    throw error;
  } finally {
    if (application) {
      await application
        .evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) window.destroy();
        })
        .catch(() => {});
      await application.close().catch(() => {});
    }
    fs.rmSync(data, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
