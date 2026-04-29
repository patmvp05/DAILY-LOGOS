/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';

let lockCount = 0;
let savedScrollY = 0;

export function useScrollLock(lock: boolean) {
  useEffect(() => {
    if (!lock) return;

    // Increment count
    lockCount++;

    // Only set styles on the first lock
    if (lockCount === 1) {
      savedScrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.width = '100%';
      // On iOS Safari, we use overflow: hidden; fixed position handles the lock.
      // Scrollbar space is less of an issue on mobile.
      document.body.style.overflow = 'hidden'; 
    }

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
        
        // requestAnimationFrame avoids layout thrash on iOS Safari
        requestAnimationFrame(() => {
          window.scrollTo(0, savedScrollY);
        });
      }
    };
  }, [lock]);
}
