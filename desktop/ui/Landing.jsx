import React from "react";
import { ArrowRight } from "lucide-react";
import logoUrl from "./assets/minutely-logo.jpg";

// Intro screen shown on launch. No accounts yet: "Get started" just opens the
// workspace. When users arrive, sign-in can slot in under the button.
export function Landing({ onStart }) {
  return (
    <main className="landing">
      <section className="landing-inner" aria-labelledby="landing-title">
        <h1 id="landing-title" className="visually-hidden">
          Minutely
        </h1>
        <img className="landing-logo" src={logoUrl} alt="Minutely" />
        <p className="landing-tagline">
          Turn what was said in a meeting into action items your team actually
          agreed to.
        </p>
        <button className="primary landing-cta" onClick={onStart}>
          Get started <ArrowRight size={18} />
        </button>
        <ol className="landing-steps">
          <li>
            <strong>Capture</strong>
            <span>Record a call or import a transcript.</span>
          </li>
          <li>
            <strong>Review</strong>
            <span>Every item is backed by a quote you can check.</span>
          </li>
          <li>
            <strong>Assign</strong>
            <span>Approve what's right and send it to Jira.</span>
          </li>
        </ol>
      </section>
      <footer className="landing-footer">
        Runs on your machine · Nothing is assigned without your approval
      </footer>
    </main>
  );
}
