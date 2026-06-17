/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fetch a URL and parse it as JSON, throwing on a non-OK response.
 *
 * (Formerly fetchWithProxy, which routed bolls.life through a Cloud Function to
 * dodge CORS. Modern Bible text is now served from same-origin static files, so
 * no proxy is needed anywhere — the remaining caller, weather, hits a
 * CORS-friendly API directly.)
 */
export async function fetchJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (response.ok) return await response.json();
  throw new Error(`API fetch failed with status ${response.status} for ${url}`);
}
