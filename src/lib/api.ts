/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The Cloud Function URL (will be accessible after deployment)
const PROXY_BASE_URL = 'https://bibleproxy-gen-lang-client-0538747272.a.run.app';

export async function fetchWithProxy(url: string, signal?: AbortSignal) {
  // If we're hitting bolls.life, we definitely want the proxy to avoid CORS
  if (url.includes('bolls.life')) {
    try {
      // Note: If using v2 functions directly on Cloud Run, the path might just be /
      // If using the default firebase-functions export, it's often /bibleProxy
      const proxyUrl = `${PROXY_BASE_URL}/bibleProxy?path=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl, { signal });
      if (response.ok) return await response.json();
    } catch (e) {
      console.warn("Proxy fetch failed, falling back to direct fetch", e);
    }
  }
  
  // Fallback to direct fetch
  const response = await fetch(url, { signal });
  if (response.ok) return await response.json();
  throw new Error(`API fetch failed with status ${response.status} for ${url}`);
}
