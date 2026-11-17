import React, { useState } from "react";
import { ArrowDown, ArrowRight, CalendarDays, CheckCheck, FileText, Mic, Send, ShieldCheck, UserRound } from "lucide-react";
import owlUrl from "./assets/owl-avatar.jpg";

const examples = [
  {
    name: "Project sync",
    speaker: "Morgan",
    quote: "I'll send the release checklist by Friday.",
    title: "Send the release checklist",
    owner: "Morgan",
    deadline: "Friday",
    confirmed: true,
  },
  {
    name: "Client call",
    speaker: "Alex",
    quote: "I'll share the revised proposal by November 20.",
    title: "Share the revised proposal",
    owner: "Alex",
    deadline: "November 20",
    confirmed: true,
  },
  {
    name: "Open question",
    speaker: "Jamie",
    quote: "Someone should update the onboarding guide.",
    title: "Update the onboarding guide",
    owner: "Owner missing",
    deadline: "Deadline missing",
    confirmed: false,
  },
];

// Intro screen shown on launch and when the sidebar owl is clicked. No accounts
// yet: "Get started" just opens the workspace. Sign-in can slot in under it.
export function Landing({ onStart }) {
  const [exampleIndex, setExampleIndex] = useState(0);
  const example = examples[exampleIndex];
  return (
    <main className="landing">
      <header className="landing-header">
        <span className="landing-wordmark"><img src={owlUrl} alt="" />Minutely</span>
        <span className="landing-edition">Your meeting companion</span>
      </header>
      <section className="landing-inner" aria-labelledby="landing-title">
        <div className="landing-copy">
          <h1 id="landing-title">
            Less follow-up.<br />More follow-through.
          </h1>
          <p className="landing-tagline">
            Turn your meeting transcript into clear action items.
            Check the source, confirm who owns what, and move work forward
            with your approval.
          </p>
          <button className="landing-cta primary" onClick={onStart}>
            Get started <ArrowRight size={18} />
          </button>
          <p className="landing-assurance">
            <ShieldCheck size={16} /> You review. You decide.
          </p>
        </div>
        <section className="landing-example" aria-label="Interactive meeting examples">
          <div className="example-heading">
            <span><CheckCheck size={18} /> See how it works</span>
            <span className="example-label">Illustrative data</span>
          </div>
          <div className="example-switcher" role="group" aria-label="Choose an example">
            {examples.map((value, index) => (
              <button
                key={value.name}
                aria-pressed={index === exampleIndex}
                onClick={() => setExampleIndex(index)}
              >
                {value.name}
              </button>
            ))}
          </div>
          <div className="example-content" aria-live="polite">
            <div className="example-transcript">
              <span className="example-section-label"><FileText size={15} /> What was said</span>
              <p className="example-speaker">{example.speaker}</p>
              <blockquote>"{example.quote}"</blockquote>
            </div>
            <div className="example-connector"><ArrowDown size={16} /> Source-backed action</div>
            <div className="example-action">
              <span className={`badge ${example.confirmed ? "CONFIRMED" : "NEEDS_INFO"}`}>
                {example.confirmed ? "Confirmed" : "Needs info"}
              </span>
              <h3>{example.title}</h3>
              <div className="example-ownership">
                <span><UserRound size={14} />{example.owner}</span>
                <span><CalendarDays size={14} />{example.deadline}</span>
              </div>
              <p className="example-review">
                <ShieldCheck size={15} />
                {example.confirmed ? "Ready for your review, not assigned automatically." : "Clarify the owner and deadline before approving."}
              </p>
            </div>
          </div>
        </section>
        <ol className="landing-steps">
          <li>
            <Mic size={22} />
            <strong>Bring the conversation</strong>
            <span>Record microphone and system audio, paste your notes, or import a transcript.</span>
          </li>
          <li>
            <FileText size={22} />
            <strong>Go straight to the evidence</strong>
            <span>Click an action to highlight its source. See commitments, open questions, and missing details.</span>
          </li>
          <li>
            <Send size={22} />
            <strong>Keep the final say</strong>
            <span>Approve the right items, then export them or send them to your connected Jira project.</span>
          </li>
        </ol>
        <div className="landing-start">
          <div>
            <h2>Your next meeting, with a clear next step.</h2>
            <p>Start with a recording or a transcript you already have.</p>
          </div>
          <button onClick={onStart}>Open workspace <ArrowRight size={17} /></button>
        </div>
      </section>
      <footer className="landing-footer">
        Runs on your machine · Nothing is assigned without your approval
      </footer>
    </main>
  );
}
