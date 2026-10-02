import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogFocus(rootRef: RefObject<HTMLElement | null>, open = true) {
  useEffect(() => {
    if (!open) return;

    const root = rootRef.current;
    if (!root) return;
    const dialog = root.matches('[role="dialog"]') ? root : root.querySelector<HTMLElement>('[role="dialog"]') ?? root;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const getFocusable = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      .filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);

    const focusable = getFocusable();
    const initialTarget = focusable[0] ?? dialog;
    if (!dialog.hasAttribute('tabindex') && initialTarget === dialog) dialog.tabIndex = -1;
    const focusFrame = window.requestAnimationFrame(() => initialTarget.focus({ preventScroll: true }));

    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const currentFocusable = getFocusable();
      if (!currentFocusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', keepFocusInside);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', keepFocusInside);
      if (opener?.isConnected) window.requestAnimationFrame(() => opener.focus({ preventScroll: true }));
    };
  }, [open, rootRef]);
}
