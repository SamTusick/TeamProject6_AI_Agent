import { LoaderCircle, X } from "lucide-react";
import { IconButton } from "./IconButton.jsx";

export function ErrorBanner({ message, onDismiss }) {
  return (
    <div className="banner error" role="alert">
      {message}
      {onDismiss && (
        <IconButton label="Dismiss error" onClick={onDismiss}>
          <X size={16} />
        </IconButton>
      )}
    </div>
  );
}

export function NoticeBanner({ message, onDismiss }) {
  return (
    <div className="banner notice">
      {message}
      <IconButton label="Dismiss notice" onClick={onDismiss}>
        <X size={16} />
      </IconButton>
    </div>
  );
}

export function BusyBanner({ label, role }) {
  return (
    <div className="banner processing" role={role}>
      <LoaderCircle size={16} className="spin" />
      {label}...
    </div>
  );
}
