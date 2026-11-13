/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Devotional } from '../types';
import { DEFAULT_DEVOTIONALS } from './storage';

/**
 * Syncing the "My Devotionals" list in Settings.
 *
 * The list starts with the built-in entries (DEFAULT_DEVOTIONALS), which exist
 * on every device, plus whatever was added in Settings. It used to live on one
 * device only: the cloud listener and the security rules were there, but
 * nothing wrote to the collection. The cloud copy is now the master list, and
 * the built-ins are stored in it like any other entry, so deleting one on a
 * phone removes it from the iPad too.
 */

const DEFAULT_ORDER = new Map(DEFAULT_DEVOTIONALS.map((d, i) => [d.id, i]));
const DEFAULT_IDS = new Set(DEFAULT_DEVOTIONALS.map((d) => d.id));

/** firestore.rules isValidDevotional: url.size() <= 500. */
export const MAX_DEVOTIONAL_URL_LENGTH = 500;

/**
 * One stable order on every device: the built-in entries in their usual order,
 * then the ones added in Settings by name. A snapshot comes back sorted by
 * document id, which for an added entry is a random UUID, so without this the
 * list would shuffle itself every time it synced.
 */
export function orderDevotionals(list: Devotional[]): Devotional[] {
  return [...list].sort((a, b) => {
    const ai = DEFAULT_ORDER.get(a.id);
    const bi = DEFAULT_ORDER.get(b.id);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);
  });
}

/**
 * The document stored for a devotional. firestore.rules requires EXACTLY these
 * three fields (`data.keys().size() == 3`), so the id, which is the document
 * name, must not be written into the document.
 */
export function toDevotionalDoc(d: Devotional): { name: string; description: string; url: string } {
  return { name: d.name, description: d.description, url: d.url };
}

/**
 * What to upload on the first cloud snapshot after launch.
 *
 * - Cloud empty (a new account, or the first sign-in since this synced): upload
 *   everything on this device, built-ins included, so the cloud becomes the
 *   full list.
 * - Cloud has entries: it wins. Upload only what the user added themselves
 *   (not a built-in): a built-in missing from the cloud was deleted on another
 *   device, and re-uploading this device's copy would bring it back.
 */
export function devotionalsToUpload(local: Devotional[], cloud: Devotional[]): Devotional[] {
  const inCloud = new Set(cloud.map((d) => d.id));
  return local.filter((d) => !inCloud.has(d.id) && (cloud.length === 0 || !DEFAULT_IDS.has(d.id)));
}
