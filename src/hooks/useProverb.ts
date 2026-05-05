/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { getProverb, type ProverbResponse } from '../lib/proverbCache';

export function useProverb(dayOfMonth: number) {
  const [proverbSnippet, setProverbSnippet] = useState<string | null>(null);
  const [proverbContent, setProverbContent] = useState<ProverbResponse | null>(null);
  const [isFetchingProverb, setIsFetchingProverb] = useState(false);
  const [, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSnippet = async () => {
      setIsFetchingProverb(true);
      setError(null);
      try {
        const data = await getProverb(dayOfMonth);
        setProverbContent(data);
        if (data.verses && data.verses.length > 0) {
          setProverbSnippet(data.verses[0].text);
        }
      } catch (err) {
        console.error('Failed to fetch proverb snippet:', err);
        setError(err instanceof Error ? err.message : 'Failed to load proverb');
      } finally {
        setIsFetchingProverb(false);
      }
    };

    fetchSnippet();
  }, [dayOfMonth]);

  return {
    proverbSnippet,
    proverbContent,
    isFetchingProverb
  };
}
