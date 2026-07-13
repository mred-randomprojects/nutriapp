import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

interface OptionProps {
  ref: ((node: HTMLButtonElement | null) => void) | undefined;
  isHighlighted: boolean;
  onMouseEnter: () => void;
}

interface OptionListKeyboard {
  /** Index of the highlighted option, or -1 when the list is empty. */
  activeIndex: number;
  /** Wire onto the search input's `onKeyDown`. */
  handleKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  /** Spread the returned props onto each option button. */
  getOptionProps: (index: number) => OptionProps;
}

/**
 * Shared keyboard behaviour for "type to search, arrow to choose" option lists
 * used across the add flows (log entry, ingredient, meal plan). ArrowUp/Down
 * move the highlight, Enter selects it, and hover syncs the highlight. The
 * highlight resets to the top whenever `resetKey` changes (typically the query)
 * and is kept scrolled into view.
 */
export function useOptionListKeyboard<T>(
  options: ReadonlyArray<T>,
  onSelect: (option: T) => void,
  resetKey: unknown,
): OptionListKeyboard {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const highlightedRef = useRef<HTMLButtonElement | null>(null);

  const activeIndex =
    options.length === 0
      ? -1
      : Math.min(highlightedIndex, options.length - 1);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [resetKey]);

  useEffect(() => {
    highlightedRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    if (event.key === "ArrowDown") {
      if (options.length === 0) return;
      event.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === "Enter") {
      if (activeIndex < 0) return;
      event.preventDefault();
      onSelect(options[activeIndex]);
    }
  }

  function getOptionProps(index: number): OptionProps {
    return {
      ref:
        index === activeIndex
          ? (node) => {
              highlightedRef.current = node;
            }
          : undefined,
      isHighlighted: index === activeIndex,
      onMouseEnter: () => setHighlightedIndex(index),
    };
  }

  return { activeIndex, handleKeyDown, getOptionProps };
}
