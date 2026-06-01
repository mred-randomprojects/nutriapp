import type { KeyboardEvent as ReactKeyboardEvent } from "react";

type EscapeCancelEvent =
  | KeyboardEvent
  | ReactKeyboardEvent<HTMLElement>;

export function isFormEscapeCancel(event: EscapeCancelEvent): boolean {
  const isComposing =
    "isComposing" in event && Boolean(event.isComposing);

  return (
    event.key === "Escape" &&
    !event.defaultPrevented &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.repeat &&
    !isComposing
  );
}

export function handleFormEscapeCancel(
  event: EscapeCancelEvent,
  onCancel: () => void,
): boolean {
  if (!isFormEscapeCancel(event)) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  onCancel();
  return true;
}
