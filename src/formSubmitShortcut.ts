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

export function submitClosestFormFromShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || !isFormSubmitShortcut(event)) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }

  const form = target.closest("form");
  if (!(form instanceof HTMLFormElement)) {
    return false;
  }

  event.preventDefault();
  form.requestSubmit();
  return true;
}
