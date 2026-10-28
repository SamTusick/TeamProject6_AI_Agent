import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { BusyBanner, ErrorBanner } from "./Banners.jsx";
import { IconButton } from "./IconButton.jsx";

export function Modal({ title, close, error, busy, children }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <IconButton label="Close dialog" onClick={close}>
          <X size={19} />
        </IconButton>
      </div>
      {error && <ErrorBanner message={error} />}
      {busy && <BusyBanner label={busy} role="status" />}
      {children}
    </dialog>
  );
}
