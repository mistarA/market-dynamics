import { useEffect, useRef } from 'react';

/**
 * Mobile back-button support for overlays.
 *
 * Browsers have no "close the top dialog" event, so an overlay that is pure
 * React state has no history entry to pop — back exits the page instead. We
 * keep one absorbable history entry ("guard") while any overlay is open and,
 * on popstate, close the most recently opened overlay in its place.
 *
 * Hash-driven routes (the research page) are left alone: `hashchange` already
 * closes them, and a guard entry sitting underneath is detected via its state
 * marker so one back press does not close two things at once.
 */

type Entry = { id: number; close: () => void };

const GUARD = '__mss_back_guard';
const stack: Entry[] = [];
let nextId = 1;
let guarded = false;
let suppress = false;
let installed = false;

function arm() {
  if (guarded) return;
  guarded = true;
  window.history.pushState(
    { ...(window.history.state ?? {}), [GUARD]: true },
    '',
  );
}

function disarm() {
  if (!guarded) return;
  guarded = false;
  suppress = true;
  window.history.back();
}

function onPop() {
  if (suppress) {
    suppress = false;
    return;
  }

  // If we landed back on a guard entry, a hash route was popped. Let
  // `hashchange` handle that navigation and keep the guard for the next press.
  if (window.history.state?.[GUARD]) {
    guarded = true;
    return;
  }

  guarded = false;
  const top = stack.pop();
  if (!top) return;
  top.close();
  if (stack.length > 0) arm();
}

function install() {
  if (installed) return;
  installed = true;
  window.addEventListener('popstate', onPop);
}

/**
 * Register an open overlay. `close` is kept in a ref so an inline callback does
 * not re-register (and churn history) on every render.
 */
export function useBackClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    install();
    if (!open) return;

    const entry: Entry = { id: nextId++, close: () => closeRef.current() };
    stack.push(entry);
    arm();

    return () => {
      const index = stack.findIndex((item) => item.id === entry.id);
      if (index >= 0) stack.splice(index, 1);
      if (stack.length === 0) disarm();
    };
  }, [open]);
}
