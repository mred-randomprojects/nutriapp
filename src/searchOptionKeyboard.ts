export interface SearchOptionKeyboardEventLike {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export function isFocusFirstSearchOptionKey(
  event: SearchOptionKeyboardEventLike,
): boolean {
  return (
    event.key === "ArrowDown" &&
    event.altKey !== true &&
    event.ctrlKey !== true &&
    event.metaKey !== true &&
    event.shiftKey !== true
  );
}
