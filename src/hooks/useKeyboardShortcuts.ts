/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';

interface Shortcuts {
  onClose?: () => void;
}

/**
 * Escape closes whatever is open.
 *
 * This also used to claim Ctrl/Cmd+K ("search", wired to an empty function)
 * and Ctrl/Cmd+N ("new journal", which after the journal was removed just
 * opened the daily proverb). Both called preventDefault, so on a desktop the
 * browser's own New Window and search shortcuts stopped working for nothing.
 */
export function useKeyboardShortcuts({ onClose }: Shortcuts) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
}
