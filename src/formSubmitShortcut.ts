export function isFormSubmitShortcut(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.repeat &&
    !event.isComposing
  );
}

/** Submit the form around `target`, if there is one. Shared by ⌘Enter and ⌘S. */
export function submitClosestForm(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const form = target.closest("form");
  if (!(form instanceof HTMLFormElement)) {
    return false;
  }

  form.requestSubmit();
  return true;
}

export function submitClosestFormFromShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || !isFormSubmitShortcut(event)) {
    return false;
  }

  if (!submitClosestForm(event.target)) {
    return false;
  }

  event.preventDefault();
  return true;
}
