import {
  useEffect,
  useRef,
  type MutableRefObject,
  type UIEvent,
} from "react";

const SCROLLBAR_IDLE_DELAY_MS = 600;

export function useScrollbarIdleTimeout(): MutableRefObject<number | null> {
  const timeoutRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    },
    [],
  );
  return timeoutRef;
}

export function revealScrollbarOnScroll(
  event: UIEvent<HTMLElement>,
  timeoutRef: MutableRefObject<number | null>,
): void {
  const scrollArea = event.currentTarget;
  if (scrollArea.dataset.scrollbarScrolling !== "true") {
    scrollArea.dataset.scrollbarScrolling = "true";
  }
  if (timeoutRef.current !== null) {
    window.clearTimeout(timeoutRef.current);
  }
  timeoutRef.current = window.setTimeout(() => {
    timeoutRef.current = null;
    scrollArea.removeAttribute("data-scrollbar-scrolling");
  }, SCROLLBAR_IDLE_DELAY_MS);
}
