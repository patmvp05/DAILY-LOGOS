/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { format } from 'date-fns';

/**
 * Today's local date as 'yyyy-MM-dd', kept fresh while the app stays open.
 *
 * A PWA left open (or resumed from the background) never remounts, so any
 * useMemo that computes "today" inside its body goes stale after midnight —
 * yesterday's stats keep showing as "Today's Reading" and the card order
 * never resets. This hook re-checks the date at the next midnight and every
 * time the tab becomes visible again, so consumers re-render exactly when
 * the day actually changes.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    const check = () => {
      const now = format(new Date(), 'yyyy-MM-dd');
      setToday((prev) => (prev === now ? prev : now));
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);

    let timer: ReturnType<typeof setTimeout>;
    const scheduleMidnight = () => {
      const now = new Date();
      // A few seconds past midnight so the clock has definitely rolled over.
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      timer = setTimeout(() => {
        check();
        scheduleMidnight();
      }, midnight.getTime() - now.getTime());
    };
    scheduleMidnight();

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(timer);
    };
  }, []);

  return today;
}
