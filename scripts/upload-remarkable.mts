/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Put the 7-day pack on the reMarkable, and prune the old ones.
 *
 * Talks to reMarkable's cloud, which is the only route that works from a
 * stateless CI runner — the on-device hacking ecosystem (Toltec/rmkit/Oxide)
 * needs physical access and, on a Paper Pro, enabling developer mode factory
 * resets the device.
 *
 * Client choice: `rmapi-js`. It is pure JS (no Go binary to fetch), it is
 * current with reMarkable's sync 1.5 / schema-4 API, and it exposes an
 * auth/session split specifically for stateless environments. The older Go and
 * Python clients are either archived or predate sync 1.5.
 *
 * Upload path: `uploadEpub` + `move`, not the lower-level `putEpub({parent})`.
 * The library's own docs describe `uploadEpub` as "a simpler api that works even
 * with schema version 4" while `putEpub` is "a little more finicky" and can
 * throw GenerationError. Uploading to root and then moving costs one extra call
 * and takes the reliable path for the part that must not fail.
 *
 * Retention: each morning uploads a NEW dated document rather than overwriting
 * one fixed document. Overwriting would be tidier, but it would throw away
 * whatever was handwritten on the note pages — and the note pages are the point.
 * Packs older than the keep window are deleted instead.
 *
 * Usage:
 *   npx tsx scripts/upload-remarkable.mts --register ABCDEFGH   # one time, on your machine
 *   npx tsx scripts/upload-remarkable.mts --probe
 *   npx tsx scripts/upload-remarkable.mts --file dist-remarkable/daily-logos-2026-08-14.epub
 *
 * Environment:
 *   REMARKABLE_TOKEN       device token from a one-time pairing (required)
 *   REMARKABLE_FOLDER      destination folder name (default "Daily Logos")
 *   REMARKABLE_KEEP_DAYS   delete dated packs older than this (default 10)
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { buildEpub, xhtmlDocument } from './lib/epub.mts';

/** Only names in exactly this shape are ever eligible for deletion. */
const DATED_PACK = /^Daily Logos (\d{4}-\d{2}-\d{2})$/;

/** A hard ceiling on deletions per run, so a bad date can't empty the folder. */
const MAX_DELETES = 25;

interface Options {
  file: string | null;
  name: string | null;
  probe: boolean;
  register: string | null;
  keepDays: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    file: null,
    name: null,
    probe: false,
    register: null,
    keepDays: Number(process.env.REMARKABLE_KEEP_DAYS ?? 10),
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--file': opts.file = next(); break;
      case '--name': opts.name = next(); break;
      case '--probe': opts.probe = true; break;
      case '--register': opts.register = next().trim(); break;
      case '--keep-days': opts.keepDays = Number(next()); break;
      case '--dry-run': opts.dryRun = true; break;
      default: throw new Error(`unknown argument "${arg}"`);
    }
  }
  if (!Number.isInteger(opts.keepDays) || opts.keepDays < 1) {
    throw new Error('keep-days must be a positive integer');
  }
  if (!opts.probe && !opts.register && !opts.file) {
    throw new Error('pass --file <path>, --probe, or --register <code>');
  }
  return opts;
}

/**
 * Exchange an 8-character pairing code for a long-lived device token.
 *
 * Run this once, on your own machine. It refuses to run in CI on purpose: the
 * token it prints is the credential itself, and CI logs are the last place it
 * should ever be written. Paste the output straight into the REMARKABLE_TOKEN
 * repository secret — not into a file, a commit, or a chat window.
 */
async function registerDevice(code: string): Promise<void> {
  if (process.env.CI) {
    throw new Error('--register prints a credential; refusing to run in CI. Do this locally.');
  }
  if (!/^[a-z0-9]{8}$/i.test(code)) {
    throw new Error(`"${code}" is not an 8-character pairing code from my.remarkable.com`);
  }
  const { register } = await import('rmapi-js');
  const token = await register(code);
  console.log('');
  console.log('Device token (store as the REMARKABLE_TOKEN repository secret, then clear your terminal):');
  console.log('');
  console.log(token);
  console.log('');
  console.log('The pairing code is now spent — a second run needs a fresh one.');
}

/**
 * Retry the cloud's optimistic-concurrency failures.
 *
 * Every write carries the root hash it expected; another device syncing at the
 * same moment invalidates it and the call throws. That is normal, not an error
 * condition — refetch and try again.
 */
async function withRetry<T>(what: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const name = (err as { name?: string })?.name ?? '';
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = name === 'GenerationError' || /generation|conflict|429|50\d/i.test(msg);
      if (!retryable || i === attempts) break;
      const waitMs = 1000 * 2 ** (i - 1);
      console.log(`[rm] ${what} failed (${msg}); retry ${i}/${attempts - 1} in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

/** The subset of a cloud listing entry that the prune decision looks at. */
export interface PruneCandidate {
  id: string;
  type: string;
  parent?: string;
  visibleName: string;
}

export type PruneDecision =
  | { action: 'delete'; docs: PruneCandidate[]; cutoff: string }
  | { action: 'skip'; reason: string };

/**
 * Decide which packs to delete.
 *
 * Split out as a pure function because this is the only part of the job that
 * destroys anything, and "which documents does the robot delete from my device"
 * deserves tests rather than a code read. Deliberately conservative: only the
 * exact `Daily Logos YYYY-MM-DD` shape in the target folder, never the document
 * just uploaded, and if an implausible number look stale it deletes nothing and
 * says so instead.
 */
export function selectStalePacks(
  items: readonly PruneCandidate[],
  o: { folderId: string; keepId: string; uploadedName: string; keepDays: number }
): PruneDecision {
  const uploadedDate = DATED_PACK.exec(o.uploadedName)?.[1];
  if (!uploadedDate) {
    return { action: 'skip', reason: `"${o.uploadedName}" is not a dated pack name` };
  }
  const cutoff = new Date(`${uploadedDate}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - o.keepDays);

  const docs = items.filter((e) => {
    if (e.type !== 'DocumentType' || e.parent !== o.folderId || e.id === o.keepId) return false;
    const d = DATED_PACK.exec(e.visibleName)?.[1];
    return !!d && new Date(`${d}T00:00:00Z`) < cutoff;
  });

  if (docs.length > MAX_DELETES) {
    return {
      action: 'skip',
      reason:
        `${docs.length} packs look stale, which is more than the ${MAX_DELETES} cap — ` +
        'leaving this for a human',
    };
  }
  return { action: 'delete', docs, cutoff: cutoff.toISOString().slice(0, 10) };
}

/** Derive the document's display name from the pack filename. */
function nameForFile(file: string): string {
  const date = /(\d{4}-\d{2}-\d{2})/.exec(basename(file))?.[1];
  if (!date) throw new Error(`cannot find a YYYY-MM-DD date in "${basename(file)}" — pass --name`);
  return `Daily Logos ${date}`;
}

async function tinyProbeEpub(stamp: string): Promise<Buffer> {
  return buildEpub({
    title: `Daily Logos probe ${stamp}`,
    author: 'Daily Logos',
    identifier: `urn:daily-logos:probe:${stamp}`,
    modified: '2026-01-01T00:00:00Z',
    css: 'body { font-family: serif; }',
    sections: [
      {
        id: 'probe',
        title: 'Probe',
        xhtml: xhtmlDocument(
          'Probe',
          `<h1>Daily Logos probe</h1><p>Connectivity check ${stamp}. Safe to delete.</p>`
        ),
      },
    ],
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.register) {
    await registerDevice(opts.register);
    return;
  }

  const token = process.env.REMARKABLE_TOKEN;
  if (!token) {
    throw new Error(
      'REMARKABLE_TOKEN is not set. Pair once at https://my.remarkable.com/device/desktop/connect ' +
      '(or /device/browser/connect), exchange the 8-character code for a device token, and store it as a secret.'
    );
  }
  const folderName = process.env.REMARKABLE_FOLDER || 'Daily Logos';

  const { remarkable } = await import('rmapi-js');
  const api = await remarkable(token);

  // ── Destination folder
  let items = await api.listItems();
  console.log(`[rm] connected; ${items.length} items in the cloud`);
  let folder = items.find(
    (e) => e.type === 'CollectionType' && e.visibleName === folderName && !e.parent
  );
  if (!folder) {
    console.log(`[rm] creating folder "${folderName}"`);
    const ref = await withRetry('create folder', () => api.uploadFolder(folderName));
    items = await api.listItems(true);
    folder = items.find((e) => e.type === 'CollectionType' && e.id === ref.id);
    if (!folder) throw new Error(`created folder "${folderName}" but it did not appear in the listing`);
  }
  const folderId = folder.id;
  console.log(`[rm] folder "${folderName}" = ${folderId}`);

  // ── The document
  const stamp = process.env.GITHUB_RUN_ID || String(process.pid);
  const visibleName = opts.name ?? (opts.probe ? `Daily Logos probe ${stamp}` : nameForFile(opts.file!));
  const buffer = opts.probe ? await tinyProbeEpub(stamp) : readFileSync(opts.file!);
  console.log(`[rm] uploading "${visibleName}" (${buffer.length} bytes)`);

  if (opts.dryRun) {
    console.log('[rm] --dry-run: stopping before any write');
    return;
  }

  const uploaded = await withRetry('upload', () => api.uploadEpub(visibleName, buffer));
  const moved = await withRetry('move into folder', () => api.move(uploaded, folderId, true));
  console.log(`[rm] uploaded id=${moved.id}`);

  // ── Confirm it is really there. An upload that "succeeded" but does not show
  // up in a fresh listing is the failure mode worth catching from CI.
  const after = await api.listItems(true);
  const landed = after.find((e) => e.id === moved.id);
  if (!landed) throw new Error(`"${visibleName}" is not in the listing after upload`);
  if (landed.visibleName !== visibleName) {
    throw new Error(`uploaded as "${visibleName}" but the cloud shows "${landed.visibleName}"`);
  }
  if (landed.parent !== folderId) {
    throw new Error(`"${visibleName}" landed in parent "${landed.parent}", not "${folderName}"`);
  }
  console.log(`[rm] verified "${landed.visibleName}" in "${folderName}"`);

  if (opts.probe) {
    console.log('[rm] probe: cleaning up');
    await withRetry('delete probe', () => api.delete(landed, true));
    const finalItems = await api.listItems(true);
    if (finalItems.some((e) => e.id === landed.id)) {
      console.log(`[rm] WARNING: probe document ${landed.id} is still listed; delete it by hand`);
    } else {
      console.log('[rm] probe cleaned up — auth, folder, upload, list and delete all work');
    }
    return;
  }

  // ── Prune
  const decision = selectStalePacks(after, {
    folderId,
    keepId: landed.id,
    uploadedName: visibleName,
    keepDays: opts.keepDays,
  });
  if (decision.action === 'skip') {
    console.log(`[rm] not pruning: ${decision.reason}`);
    return;
  }
  if (decision.docs.length === 0) {
    console.log(`[rm] nothing older than ${decision.cutoff} to prune`);
    return;
  }
  for (const doc of decision.docs) {
    console.log(`[rm] pruning "${doc.visibleName}"`);
    const ref = after.find((e) => e.id === doc.id)!;
    await withRetry(`delete ${doc.visibleName}`, () => api.delete(ref, true));
  }
  console.log(`[rm] pruned ${decision.docs.length} pack(s) older than ${opts.keepDays} days`);
}

// Only run when executed directly — the test imports selectStalePacks.
if (process.argv[1] && /upload-remarkable\.mts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(`[rm] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
