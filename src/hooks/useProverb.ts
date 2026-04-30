/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { getProverb } from '../lib/proverbCache';

export function useProverb(dayOfMonth: number) {
  const [proverbSnippet, setProverbSnippet] = useState<string | null>(null);
  const [proverbContent, setProverbContent] = useState<any | null>(null);
  const [isFetchingProverb, setIsFetchingProverb] = useState(false);

  useEffect(() => {
    const fetchSnippet = async () => {
      setIsFetchingProverb(true);
      try {
        const data = await getProverb(dayOfMonth);
        setProverbContent(data);
        if (data.verses && data.verses.length > 0) {
          setProverbSnippet(data.verses[0].text);
        }
      } catch (e) {
        console.error('Failed to fetch proverb snippet:', e);
      } finally {
        setIsFetchingProverb(false);
      }
    };

    // Defer non-critical work
    if ('requestIdleCallback' in window) {
      const handle = (window as any).requestIdleCallback(() => fetchSnippet());
      return () => (window as any).cancelIdleCallback(handle);
    } else {
      const timer = setTimeout(fetchSnippet, 100);
      return () => clearTimeout(timer);
    }
  }, [dayOfMonth]);

  return {
    proverbSnippet,
    proverbContent,
    isFetchingProverb
  };
}
