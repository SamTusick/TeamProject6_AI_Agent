import { ShieldCheck } from "lucide-react";

export function Topbar() {
  return (
    <header className="topbar">
      <span>
        WORKSPACE / <b>MEETINGS</b>
      </span>
      <span className="privacy">
        <ShieldCheck size={15} /> Human-approved decisions
      </span>
    </header>
  );
}

export function PageFooter() {
  return (
    <footer className="main-footer">
      <span>TEAM6 / DESKTOP PREVIEW</span>
      <span>Local speech / Whisper base</span>
    </footer>
  );
}
