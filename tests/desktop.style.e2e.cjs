const { _electron: electron } = require("playwright");
const { expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MeetingStore } = require("../desktop/store.cjs");

async function readable(locator) {
  const ratio = await locator.evaluate((element) => {
    const rgba = (value) => value.match(/[\d.]+/g).map(Number);
    const blend = (foreground, background) => {
      const alpha = foreground[3] ?? 1;
      return foreground.slice(0, 3).map((channel, i) =>
        channel * alpha + background[i] * (1 - alpha));
    };
    const ancestors = [];
    for (let node = element; node; node = node.parentElement)
      ancestors.unshift(node);
    let background = [255, 255, 255];
    for (const node of ancestors)
      background = blend(rgba(getComputedStyle(node).backgroundColor), background);
    const foreground = blend(rgba(getComputedStyle(element).color), background);
    const luminance = (rgb) => rgb.map((value) => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  });
  assert.ok(ratio >= 4.5, `${locator}: text contrast ${ratio.toFixed(2)} must be >= 4.5`);
}

async function fits(page, selector) {
  const overflow = await page.locator(selector).evaluateAll((elements) =>
    elements.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1 ||
        element.scrollWidth > element.clientWidth + 1);
    }).map((element) => element.className));
  assert.deepEqual(overflow, [], `Horizontal overflow: ${selector}`);
  assert.equal(await page.evaluate(() =>
    document.documentElement.scrollWidth > innerWidth), false);
}

async function main() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "team6-style-"));
  const artifacts = path.resolve("test-artifacts");
  fs.mkdirSync(artifacts, { recursive: true });
  const store = new MeetingStore(path.join(data, "meetings"));
  const source = "Taylor: I will finish the budget report by Friday.";
  const secondSource = "Morgan: Who will own the documentation?\nCasey: We still need an owner.";
  const transcript = [
    source,
    ...Array.from({ length: 35 }, (_, i) => `Morgan: Discussion point ${i + 1}, with context for the team to review.`),
    secondSource,
  ].join("\n");
  const meeting = store.create("Weekly project sync", transcript);
  store.setAnalysis(meeting.id, [{
    title: "Finish the budget report",
    owner: "Taylor",
    deadline: "Friday",
    classification: "CONFIRMED",
    quote: source,
    verified: true,
    reason: "eligible",
  }, {
    title: "Clarify the documentation handoff",
    owner: "",
    deadline: "",
    classification: "NEEDS_INFO",
    quote: secondSource,
    verified: true,
    clarifying_question: "Who will own the documentation?",
    reason: "Owner and deadline missing",
  }, {
    title: "Check an unsupported item",
    owner: "",
    deadline: "",
    classification: "DISCUSSED_ONLY",
    quote: "Zebras juggle emeralds underwater.",
    verified: false,
    reason: "Quote not found in transcript",
  }]);
  let application;
  try {
    const env = { ...process.env, TEAM6_TEST_DATA: data };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await electron.launch({ args: ["."], env });
    const page = await application.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const resize = async (width) => {
      await application.evaluate(({ BrowserWindow }, width) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setMinimumSize(320, 480);
        window.setContentSize(width, 840);
      }, width);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
    };
    const screenshot = (name) => page.screenshot({
      path: path.join(artifacts, `ui-${name}.png`), fullPage: true, scale: "css",
    });
    await page.getByRole("button", { name: "Get started" }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const width of [360, 480, 768, 1024, 1280]) {
      await resize(width);
      await fits(page, ".landing, .landing-copy, .landing-example, .example-action, .example-switcher, .landing-steps, .landing-start");
      if (width === 480 || width === 1280) await screenshot(`landing-${width}`);
    }
    await readable(page.locator(".landing-tagline"));
    await readable(page.locator(".landing-cta"));
    await page.getByRole("button", { name: "Client call", exact: true }).click();
    await expect(page.locator(".example-action h3")).toHaveText("Share the revised proposal");
    await page.getByRole("button", { name: "Open question", exact: true }).click();
    await expect(page.locator(".example-action .badge")).toHaveText("Needs info");
    await expect(page.locator(".example-review")).toContainText("Clarify the owner and deadline");
    await fits(page, ".landing-example, .example-action");
    await page.getByRole("button", { name: "Project sync", exact: true }).click();
    assert.equal(store.list().length, 1, "Home examples must not create real meetings");
    await page.getByRole("button", { name: "Get started" }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Project sync", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Get started" })).toBeFocused();
    assert.ok(await page.locator(".landing-cta").evaluate((element) =>
      parseFloat(getComputedStyle(element).outlineWidth) >= 2));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: meeting.title })).toBeVisible();
    console.log("PASS: responsive landing, interactive examples, readable copy and keyboard entry");

    for (const width of [360, 480, 768, 1024, 1280]) {
      await resize(width);
      await fits(page, ".sidebar, .meeting-heading, .metrics, .workspace-grid, .action-item, .toolbar");
      if (width === 480 || width === 1280) await screenshot(`workspace-${width}`);
    }
    for (const selector of [".eyebrow", ".metrics span", ".section-label",
      ".meeting-link.selected small", ".transcript-footer", ".badge.CONFIRMED",
      ".badge.NEEDS_INFO", ".verified", ".quote", ".ownership"]) {
      await readable(page.locator(selector).first());
    }
    await expect(page.locator('.meeting-link[aria-current="page"]')).toContainText(meeting.title);
    await page.getByRole("tab", { name: "Eligible", exact: true }).click();
    await expect(page.locator(".action-item")).toHaveCount(1);
    await page.locator(".ownership").click();
    const marks = page.locator(".transcript-document mark");
    await expect(marks).toHaveText("Taylor: I will finish the budget report by Friday");
    assert.equal(store.read(meeting.id).items[0].decision, "pending");
    await page.getByRole("tab", { name: "Needs info", exact: true }).click();
    await expect(page.locator(".question")).toContainText("Who will own");
    await page.getByRole("button", { name: "View transcript source: Clarify the documentation handoff" }).focus();
    await page.keyboard.press("Enter");
    await expect(marks).toHaveText([
      "Morgan: Who will own the documentation?",
      "Casey: We still need an owner",
    ]);
    await expect(marks.first()).toBeFocused();
    await expect.poll(() => page.locator(".transcript-document").evaluate((element) =>
      element.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => marks.first().evaluate((mark) => {
      const line = mark.getBoundingClientRect();
      const pane = mark.closest(".transcript-document").getBoundingClientRect();
      return line.top >= pane.top && line.top < pane.bottom;
    })).toBe(true);
    await readable(marks.first());
    await page.getByRole("tab", { name: "All items", exact: true }).click();
    await page.locator(".action-item").first().getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.locator(".action-item.approved")).toHaveCount(1);
    assert.equal(store.read(meeting.id).items[0].decision, "approved");
    await expect(marks).toHaveCount(2);
    await expect(page.locator(".source-selected")).toContainText("Clarify the documentation handoff");
    await page.getByRole("button", { name: "View transcript source: Finish the budget report" }).click();
    await expect(marks).toHaveText("Taylor: I will finish the budget report by Friday");
    await expect.poll(() => page.locator(".transcript-document").evaluate((element) =>
      element.scrollTop)).toBeLessThan(1);
    await screenshot("source-linked-1280");
    await page.getByRole("button", { name: "View transcript source: Check an unsupported item" }).click();
    await expect(page.getByText("Couldn't find that quote in the transcript.")).toBeVisible();
    await expect(marks).toHaveCount(0);
    await page.getByRole("button", { name: "Dismiss notice" }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Meeting transcript" })).toHaveValue(transcript);
    await expect(page.getByRole("button", { name: "View transcript source: Finish the budget report" })).toBeDisabled();
    await page.getByRole("textbox", { name: "Meeting transcript" }).fill("Unsaved draft");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(store.read(meeting.id).transcript, transcript);
    await expect(page.locator(".transcript-line")).toHaveCount(38);
    await resize(480);
    await page.getByRole("button", { name: "View transcript source: Clarify the documentation handoff" }).click();
    await expect(marks).toHaveCount(2);
    await expect.poll(() => marks.first().evaluate((mark) => {
      const rect = mark.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    })).toBe(true);
    await fits(page, ".transcript-document, .transcript-line, .action-item");
    await resize(1280);
    await page.getByRole("tab", { name: "All items", exact: true }).click();
    await page.getByLabel("Search meetings").fill("not found");
    await expect(page.getByText("No matching meetings.")).toBeVisible();
    await page.getByLabel("Search meetings").fill("");
    console.log("PASS: responsive review, multiline source navigation, keyboard access, missing quotes, independent approval and preserved edits");

    await page.getByRole("button", { name: "Record or add transcript", exact: true }).click();
    for (const width of [360, 480, 1280]) {
      await resize(width);
      await fits(page, "dialog, .dialog-actions");
    }
    await page.getByLabel("Meeting title", { exact: true }).fill("A new planning session");
    await screenshot("new-meeting");
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Connections", exact: true }).click();
    await resize(480);
    await fits(page, "dialog, .connection-heading, .connection-info, .dialog-actions");
    await screenshot("connections-480");
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Delete meeting", exact: true }).click();
    const dialog = page.locator(".confirm-dialog");
    await expect(dialog).toBeVisible();
    await fits(page, ".confirm-dialog, .confirm-body, .confirm-actions");
    assert.equal(await dialog.evaluate((element) =>
      getComputedStyle(element).animationName), "none");
    assert.equal(await dialog.getByRole("button", { name: "Cancel", exact: true }).evaluate((element) =>
      getComputedStyle(element).transitionDuration), "0s");
    await screenshot("confirmation-480");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.ok(store.list().some((value) => value.id === meeting.id));
    await page.getByRole("button", { name: "Delete meeting", exact: true }).click();
    await dialog.getByRole("button", { name: "Delete meeting", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your meeting workspace" })).toBeVisible();
    await fits(page, ".empty-workspace, .empty-actions");
    await screenshot("empty-480");
    await page.getByRole("button", { name: "Record a meeting", exact: true }).click();
    await page.getByLabel("Meeting title", { exact: true }).fill("Synthetic recording");
    await fits(page, "dialog, .record-sources, .dialog-actions");
    await screenshot("record-dialog-480");
    await page.evaluate(() => {
      const context = new AudioContext();
      const tone = () => {
        const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        return destination.stream;
      };
      navigator.mediaDevices.getDisplayMedia = async () => tone();
      navigator.mediaDevices.getUserMedia = async () => tone();
    });
    await page.getByRole("button", { name: "Start recording", exact: true }).click();
    await dialog.getByRole("button", { name: "Start recording", exact: true }).click();
    await expect(page.getByRole("region", { name: "Active recording" })).toBeVisible();
    for (const width of [360, 480, 1280]) {
      await resize(width);
      await fits(page, ".recording-band");
      if (width === 1280) await screenshot("recording-1280");
    }
    await expect.poll(() => page.locator("canvas").evaluate((canvas) =>
      canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height)
        .data.some((channel, i) => i % 4 === 3 && channel > 0))).toBe(true);
    await readable(page.locator(".recording-band small"));
    await page.getByRole("button", { name: "Stop recording", exact: true }).click();
    await expect(page.getByRole("button", { name: "Play recording" })).toBeVisible();
    await page.getByRole("button", { name: "Minutely home", exact: true }).click();
    await page.getByRole("button", { name: "Open workspace", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Synthetic recording", exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
    console.log("PASS: responsive dialogs/recording, waveform, reduced motion, cancellation, empty state and no renderer errors");
  } finally {
    if (application) await application.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
