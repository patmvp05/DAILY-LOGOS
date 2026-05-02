/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The Cloud Function URL (will be accessible after deployment)
const PROXY_BASE_URL = 'https://bibleproxy-gen-lang-client-0538747272.a.run.app';

export async function fetchWithProxy(url: string, signal?: AbortSignal) {
  try {
    // Attempt proxy fetch first to avoid CORS and provide server-side reliability
    const proxyUrl = `${PROXY_BASE_URL}/bibleProxy?path=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl, { signal });
    if (response.ok) return await response.json();
  } catch (e) {
    console.warn("Proxy fetch failed or not yet deployed, falling back to direct fetch", e);
  }
  
  // Fallback to direct fetch
  const response = await fetch(url, { signal });
  if (response.ok) return await response.json();
  throw new Error(`Fetch failed: ${response.status}`);
}
