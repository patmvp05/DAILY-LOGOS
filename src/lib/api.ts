/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const PROXY_BASE_URL = 'https://bibleproxy-gen-lang-client-0538747272.a.run.app';

export async function fetchWithProxy(url: string, signal?: AbortSignal) {
  if (url.includes('bolls.life')) {
    // 1. Try direct browser fetch first — browsers handle Cloudflare JS
    //    challenges natively and bolls.life may allow cross-origin requests.
    try {
      const direct = await fetch(url, { signal });
      if (direct.ok) return await direct.json();
    } catch {
      // CORS block or network error — fall through to proxy
    }

    // 2. Fall back to the Cloud Function proxy.
    try {
      const proxyUrl = `${PROXY_BASE_URL}/bibleProxy?path=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl, { signal });
      if (response.ok) return await response.json();
    } catch {
      // proxy also failed
    }

    throw new Error(`Failed to fetch ${url} (direct and proxy both failed)`);
  }

  const response = await fetch(url, { signal });
  if (response.ok) return await response.json();
  throw new Error(`API fetch failed with status ${response.status} for ${url}`);
}
