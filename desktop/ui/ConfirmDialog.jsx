import React, { useEffect, useRef } from "react";
import { CircleHelp, TriangleAlert, X } from "lucide-react";
import { IconButton } from "./IconButton.jsx";

// Styled replacement for the native Windows confirmation box. Cancel is focused
// by default (as the native box did), and Escape or the close button cancels.
export function ConfirmDialog({ request, onAnswer }) {
  const ref = useRef(null);
  const cancelRef = useRef(null);
  useEffect(() => {
    ref.current.showModal();
    cancelRef.current.focus();
  }, []);
  const Icon = request.danger ? TriangleAlert : CircleHelp;
  return (
    <dialog
      ref={ref}
      className={`confirm-dialog ${request.danger ? "danger" : ""}`}
      aria-labelledby={`confirm-title-${request.id}`}
      aria-describedby={`confirm-detail-${request.id}`}
      onCancel={(event) => {
        event.preventDefault();
        onAnswer(false);
      }}
    >
      <div className="confirm-body">
        <span className="confirm-icon">
          <Icon size={22} />
        </span>
        <div>
          <h2 id={`confirm-title-${request.id}`}>{request.message}</h2>
          {request.detail && (
            <p id={`confirm-detail-${request.id}`}>{request.detail}</p>
          )}
        </div>
        <IconButton label="Close dialog" onClick={() => onAnswer(false)}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="confirm-actions">
        <button ref={cancelRef} onClick={() => onAnswer(false)}>
          Cancel
        </button>
        <button
          className={request.danger ? "danger-button" : "primary"}
          onClick={() => onAnswer(true)}
        >
          {request.confirm || "Continue"}
        </button>
      </div>
    </dialog>
  );
}
