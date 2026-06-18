/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { getDevotional, type DevotionalContent } from '../lib/devotionalContent';
import { getLocalMonthDay } from '../lib/devotionalCatalog';

export function useDevotional(slug: string | null, monthDay?: string) {
  const [devotionalContent, setDevotionalContent] = useState<DevotionalContent | null>(null);
  const [isFetchingDevotional, setIsFetchingDevotional] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setDevotionalContent(null);
      setError(null);
      return;
    }

    let active = true;
    const fetchContent = async () => {
      setIsFetchingDevotional(true);
      setError(null);
      try {
        const day = monthDay || getLocalMonthDay();
        const data = await getDevotional(slug, day);
        if (!active) return;
        setDevotionalContent(data);
      } catch (err) {
        if (!active) return;
        console.error('Failed to fetch devotional:', err);
        setError(err instanceof Error ? err.message : 'Failed to load devotional');
      } finally {
        if (active) setIsFetchingDevotional(false);
      }
    };

    fetchContent();
    return () => { active = false; };
  }, [slug, monthDay]);

  return {
    devotionalContent,
    isFetchingDevotional,
    error
  };
}
