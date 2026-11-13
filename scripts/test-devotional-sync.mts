/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests syncing the "My Devotionals" list in Settings.
 *
 * It used to live on one device: the listener and the rules existed but nothing
 * wrote to the collection. The risk in adding writes is the built-in entries
 * (Insight, My Utmost, ...), which exist on every device but not in the cloud:
 * a snapshot holding only the entry just added would REPLACE the list and wipe
 * them. These tests pin that, plus the exact document shape firestore.rules
 * demands.
 *
 * Run with: npx tsx scripts/test-devotional-sync.mts
 */
import { readFileSync } from 'node:fs';
import { appReducer } from '../src/state/appReducer';
import { DEFAULT_DEVOTIONALS } from '../src/lib/storage';
import {
  orderDevotionals, toDevotionalDoc, devotionalsToUpload, MAX_DEVOTIONAL_URL_LENGTH,
} from '../src/lib/devotionalSync';
import type { AppState, Devotional } from '../src/types';

let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; } else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

const dev = (id: string, name: string): Devotional => ({ id, name, description: 'd', url: 'https://x.test/' });
const ids = (l: Devotional[]) => l.map((d) => d.id).join(',');
const DEFAULT_IDS = DEFAULT_DEVOTIONALS.map((d) => d.id);

function stateWith(list: Devotional[]): AppState {
  return {
    progress: [], settings: { startDate: '2026-01-01', theme: 'system' }, history: [],
    proverbJournals: [], customDevotionals: list, scriptureSprints: [], completedBooks: new Set(),
  } as unknown as AppState;
}

// ── Ordering: built-ins first in their usual order, then the user's by name
{
  const mine = [dev('zzz', 'Zebra daily'), dev('aaa', 'apple daily')];
  const shuffled = [mine[0], DEFAULT_DEVOTIONALS[4], mine[1], DEFAULT_DEVOTIONALS[0], DEFAULT_DEVOTIONALS[2]];
  const out = orderDevotionals(shuffled);
  ok('built-ins come first, in their usual order',
    ids(out.slice(0, 3)) === DEFAULT_IDS.filter((i) => ['insight', 'spurgeon', 'daily-bread'].includes(i)).join(','), ids(out));
  ok('then the user\'s own, by name (case-insensitive)', ids(out.slice(3)) === 'aaa,zzz', ids(out));
  ok('ordering is stable whatever order it starts in', ids(orderDevotionals([...shuffled].reverse())) === ids(out));
  ok('ordering does not change the input', shuffled[0].id === 'zzz');
}

// ── The document written to the cloud
{
  const d = toDevotionalDoc(dev('abc', 'N'));
  ok('the stored document has exactly name, description, url',
    Object.keys(d).sort().join(',') === 'description,name,url', Object.keys(d).join(','));
  ok('the id is not stored inside the document (rules require exactly 3 keys)', !('id' in d));
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  ok('firestore.rules still demands exactly those 3 keys',
    /isValidDevotional[\s\S]*?hasAll\(\['name', 'description', 'url'\]\)[\s\S]*?keys\(\)\.size\(\) == 3/.test(rules));
  ok('the URL cap matches the rules', rules.includes('data.url.size() <= 500') && MAX_DEVOTIONAL_URL_LENGTH === 500);
}

// ── THE DANGEROUS CASE: a snapshot of one custom entry must not wipe the built-ins
{
  const mine = dev('custom-1', 'My own');
  // Cloud already holds the full list (what first-run seeding leaves behind).
  const full = [...DEFAULT_DEVOTIONALS, mine];
  let s = appReducer(stateWith([...DEFAULT_DEVOTIONALS]), { type: 'CLOUD_SYNC_DEVOTIONALS', devotionals: full });
  ok('a snapshot with the full list keeps every built-in', DEFAULT_IDS.every((i) => s.customDevotionals.some((d) => d.id === i)), ids(s.customDevotionals));
  ok('and adds the new one', s.customDevotionals.some((d) => d.id === 'custom-1'));

  // An EMPTY cloud (never seeded) must not blank the list.
  s = appReducer(stateWith([...DEFAULT_DEVOTIONALS]), { type: 'CLOUD_SYNC_DEVOTIONALS', devotionals: [] });
  ok('an empty cloud list never blanks the device\'s list', s.customDevotionals.length === DEFAULT_DEVOTIONALS.length);

  // Adding locally keeps the list in the shared order.
  s = appReducer(stateWith([...DEFAULT_DEVOTIONALS]), { type: 'ADD_DEVOTIONAL', devotional: mine });
  ok('adding puts the new entry after the built-ins', ids(s.customDevotionals) === [...DEFAULT_IDS, 'custom-1'].join(','), ids(s.customDevotionals));

  // A delete made elsewhere arrives as a smaller list and is honoured.
  const without = full.filter((d) => d.id !== 'daily-bread');
  s = appReducer(stateWith(full), { type: 'CLOUD_SYNC_DEVOTIONALS', devotionals: without });
  ok('a built-in deleted on another device disappears here', !s.customDevotionals.some((d) => d.id === 'daily-bread'));

  // No change, no re-render.
  const same = stateWith(orderDevotionals(full));
  ok('an identical snapshot returns the same state object',
    appReducer(same, { type: 'CLOUD_SYNC_DEVOTIONALS', devotionals: [...full].reverse() }) === same);
}

// ── What a device uploads on its first snapshot
{
  const mine = dev('custom-1', 'My own');
  const local = [...DEFAULT_DEVOTIONALS, mine];

  ok('empty cloud: everything on the device is uploaded, built-ins included',
    ids(devotionalsToUpload(local, [])) === ids(local));

  const cloudWithoutBread = DEFAULT_DEVOTIONALS.filter((d) => d.id !== 'daily-bread');
  const up = devotionalsToUpload(local, cloudWithoutBread);
  ok('a built-in missing from a non-empty cloud was deleted elsewhere: not brought back',
    !up.some((d) => d.id === 'daily-bread'), ids(up));
  ok('but an entry the user added is uploaded', up.some((d) => d.id === 'custom-1'));
  ok('nothing is uploaded when the cloud already has everything', devotionalsToUpload(local, local).length === 0);
}

// ── Wiring
{
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const settings = read('../src/components/modals/SettingsModal.tsx');
  ok('adding in Settings writes to the cloud', /ADD_DEVOTIONAL[\s\S]{0,400}writeDevotionals\(user\.uid/.test(settings));
  ok('deleting in Settings deletes in the cloud', /DELETE_DEVOTIONAL[\s\S]{0,200}deleteDevotional\(user\.uid, dev\.id\)/.test(settings));
  ok('an over-long link is refused before any write', settings.includes('MAX_DEVOTIONAL_URL_LENGTH'));
  const hook = read('../src/hooks/useFirestoreSync.ts');
  ok('the first snapshot uploads this device\'s list', /!firstFire\.has\('Devotionals'\)[\s\S]{0,300}devotionalsToUpload\(/.test(hook));
  const sync = read('../src/lib/sync.ts');
  ok('Reset Progress still leaves devotionals alone', !/resetUserData[\s\S]{0,700}getDevotionalsCollection/.test(sync));
}

console.log('');
if (fail === 0) {
  console.log(`DEVOTIONAL-SYNC PASS ${pass} / ${pass}`);
} else {
  console.log(`DEVOTIONAL-SYNC FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
