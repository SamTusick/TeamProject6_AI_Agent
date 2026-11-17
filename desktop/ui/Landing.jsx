import React from "react";
import { ArrowRight } from "lucide-react";
import owlUrl from "./assets/owl-sitting.png";

// Intro screen shown on launch and when the sidebar owl is clicked. No accounts
// yet: "Get started" just opens the workspace. Sign-in can slot in under it.
export function Landing({ onStart }) {
  return (
    <main className="landing">
      <section className="landing-inner" aria-labelledby="landing-title">
        <div className="landing-lockup">
          <img className="landing-owl" src={owlUrl} alt="" />
          <h1 id="landing-title" className="landing-wordmark">
            Minutely
          </h1>
        </div>
        <p className="landing-tagline">
          Turn what was said in a meeting into action items your team actually
          agreed to.
        </p>
        <button className="landing-cta" onClick={onStart}>
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
