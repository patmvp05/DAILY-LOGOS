/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { getProverb, refetchProverb, type ProverbResponse } from '../lib/proverbCache';
import { resolveBibleVersion } from '../constants';
import { textCheckKey, useTextCheckedAt } from '../lib/textCheckLog';

export function useProverb(dayOfMonth: number, version?: string) {
  // The loaded chapter is kept together with the request it answers, and only
  // handed out while it still matches. It used to be replaced on success only,
  // so when a load failed (the app left open across midnight with no signal, or
  // a version switch offline) yesterday's chapter stayed on screen under
  // today's heading, with a green "all verses checked" badge, and "Done
  // reading" logged today's chapter as read.
  const versionId = resolveBibleVersion(version);
  const requestKey = `${versionId}_${dayOfMonth}`;
  const [loaded, setLoaded] = useState<{ key: string; data: ProverbResponse } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [retry, setRetry] = useState(0);

  const proverbContent = loaded && loaded.key === requestKey ? loaded.data : null;
  const proverbSnippet = proverbContent?.verses[0]?.text ?? null;

  // Changes whenever this chapter is loaded from storage or the network again,
  // including by the dashboard's "Download again", which does not go through
  // this hook. Without it the dashboard turned green while this hook kept
  // showing the copy that had failed.
  const checkedAt = useTextCheckedAt(textCheckKey(versionId, 'Proverbs', dayOfMonth));

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await getProverb(dayOfMonth, versionId);
        if (active) setLoaded({ key: requestKey, data });
      } catch (err) {
        if (active) console.error('Failed to fetch proverb:', err);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [dayOfMonth, versionId, requestKey, retry, checkedAt]);

  // A failed load is tried again when the connection comes back. Only while
  // there is nothing to show: a loaded chapter needs no retry.
  useEffect(() => {
    if (proverbContent) return;
    const onOnline = () => setRetry((n) => n + 1);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [proverbContent]);

  // Skips every saved copy: for a chapter that failed its text check.
  const reloadProverb = async () => {
    setIsReloading(true);
    try {
      const data = await refetchProverb(dayOfMonth, versionId);
      setLoaded({ key: requestKey, data });
    } catch (err) {
      console.error('Failed to reload proverb:', err);
    } finally {
      setIsReloading(false);
    }
  };

  return {
    proverbSnippet,
    proverbContent,
    // A background re-read of a chapter already on screen is not "loading":
    // showing the spinner for it would blank the text for a moment.
    isFetchingProverb: isReloading || (isLoading && !proverbContent),
    reloadProverb,
  };
}
