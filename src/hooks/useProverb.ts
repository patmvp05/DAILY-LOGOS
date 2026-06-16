/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { getProverb, type ProverbResponse } from '../lib/proverbCache';

export function useProverb(dayOfMonth: number, version?: string) {
  const [proverbSnippet, setProverbSnippet] = useState<string | null>(null);
  const [proverbContent, setProverbContent] = useState<ProverbResponse | null>(null);
  const [isFetchingProverb, setIsFetchingProverb] = useState(false);
  const [, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const fetchSnippet = async () => {
      setIsFetchingProverb(true);
      setError(null);
      try {
        const data = await getProverb(dayOfMonth, version);
        if (!active) return;
        setProverbContent(data);
        if (data.verses && data.verses.length > 0) {
          setProverbSnippet(data.verses[0].text);
        }
      } catch (err) {
        if (!active) return;
        console.error('Failed to fetch proverb snippet:', err);
        setError(err instanceof Error ? err.message : 'Failed to load proverb');
      } finally {
        if (active) setIsFetchingProverb(false);
      }
    };

    fetchSnippet();
    return () => { active = false; };
  }, [dayOfMonth, version]);

  return {
    proverbSnippet,
    proverbContent,
    isFetchingProverb
  };
}
