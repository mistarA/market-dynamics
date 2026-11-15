import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/** Keep the panel clear of the viewport edges. */
const MARGIN = 12;
const GAP = 0;
const PANEL_MAX = 360;
/** Grace period for moving the pointer from the row into the panel. */
const HIDE_DELAY_MS = 250;

/**
 * Touch taps emit a synthetic `mouseenter` but never a matching `mouseleave`,
 * which would leave the panel stuck on top of a drawer. Track the real pointer
 * type once, globally, so only a mouse can open the panel.
 */
let lastPointerType = 'mouse';
if (typeof document !== 'undefined') {
  const track = (event: PointerEvent) => {
    lastPointerType = event.pointerType;
  };
  document.addEventListener('pointermove', track, true);
  document.addEventListener('pointerdown', track, true);
}

/**
 * Small anchored popover used by the row indicators.
 *
 * The panel is portalled to the body so a scrolling table cannot clip it. It
 * stays open while the pointer crosses into it, so the filing links inside are
 * actually clickable.
 */
export function useHoverPop<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHide = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const dismiss = () => {
    cancelHide();
    setAnchor(null);
  };

  const show = () => {
    if (lastPointerType !== 'mouse') return;
    cancelHide();
    if (ref.current) setAnchor(ref.current.getBoundingClientRect());
  };

  const hide = () => {
    cancelHide();
    timer.current = setTimeout(() => {
      setAnchor(null);
      timer.current = null;
    }, HIDE_DELAY_MS);
  };

  return { ref, anchor, show, hide, cancelHide, dismiss };
}

export function HoverPop({
  anchor,
  children,
  onHold,
  onRelease,
  onDismiss,
}: {
  anchor: DOMRect | null;
  children: ReactNode;
  onHold: () => void;
  onRelease: () => void;
  onDismiss: () => void;
}) {
  const panel = useRef<HTMLDivElement | null>(null);

  // Any press outside the panel (opening a drawer, tapping another row) closes
  // it immediately rather than leaving it floating over a modal.
  useEffect(() => {
    if (!anchor) return;
    const onDown = (event: PointerEvent) => {
      if (panel.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onDismiss]);

  if (!anchor) return null;

  // The indicator column sits near the right edge of the table, so anchoring
  // at the cell's left side would push the panel off-screen. Match the CSS
  // width here and clamp into the viewport.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(PANEL_MAX, vw - MARGIN * 2);
  const left = Math.max(
    MARGIN,
    Math.min(anchor.left, vw - width - MARGIN),
  );

  // Open upwards when the anchor is in the lower part of the screen.
  const flipUp = anchor.bottom + GAP > vh * 0.62;
  const style: CSSProperties = flipUp
    ? { left, bottom: vh - anchor.top + GAP }
    : { left, top: anchor.bottom + GAP };

  return createPortal(
    <div
      ref={panel}
      className="hover-pop"
      style={style}
      onMouseEnter={onHold}
      onMouseLeave={onRelease}
      onFocusCapture={onHold}
    >
      {children}
    </div>,
    document.body,
  );
}
