/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Multi-device sync simulator.
 *
 * Drives the REAL production logic (appReducer, resolveProgressConflict,
 * calculateNextProgress) and a faithful re-implementation of the sync layer's
 * read/write/reconcile transforms from useFirestoreSync + sync.ts, across N
 * simulated devices sharing one simulated Firestore. Each device can advance,
 * jump, go offline/online, and receive realtime snapshots. Per-device clock
 * skew is injected by mocking the global clock so we can prove the resolver is
 * skew-immune.
 *
 * Run: npx tsx scripts/sim-sync.mts
 *
 * Invariants checked after every scenario settles (all devices online+synced):
 *   CONV   every device + the cloud agree on every category's position
 *   NOREV  in advance-only scenarios, each category's final position equals
 *          the furthest position ever reached (a read chapter never reverts)
 *   HIST   every history id ever created survives in the cloud (up to the cap),
 *          with no duplicates
 *   COMPLETE completedBooks is identical across devices and the cloud
 */
import { appReducer, resolveProgressConflict, HISTORY_CAP } from '../src/state/appReducer';
import { calculateNextProgress } from '../src/lib/bible';
import { CATEGORIES, CATEGORIES_BY_ID } from '../src/constants';
import type { AppState, Progress, HistoryEntry } from '../src/types';

// ── deterministic RNG (mulberry32) ────────────────────────────────────
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── controllable clock (mock Date so the reducer stamps skewed times) ──
const RealDate = Date;
let simNow = 1_700_000_000_000;
let activeOffset = 0;
function installClock() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Date = class extends RealDate {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      if (args.length === 0) super(simNow + activeOffset);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      else super(...(args as []));
    }
    static now() { return simNow + activeOffset; }
  };
}
function restoreClock() { (globalThis as Record<string, unknown>).Date = RealDate; }

// ── simulated Firestore ────────────────────────────────────────────────
interface CloudProgress extends Progress { serverMillis: number; }
class Cloud {
  progress = new Map<string, CloudProgress>();
  history = new Map<string, HistoryEntry>();
  completed = new Set<string>();
  private serverClock = 1;

  writeProgress(p: Progress) {
    // Mirrors writeActionBatch: keep the device's updatedAtMillis, add a fresh
    // server timestamp.
    this.progress.set(p.categoryId, {
      ...p,
      updatedAtMillis: p.updatedAtMillis || (simNow + activeOffset),
      serverMillis: this.serverClock++,
    });
  }
  writeHistory(entries: HistoryEntry[]) { entries.forEach(h => this.history.set(h.id, h)); }
  setCompleted(key: string) { this.completed.add(key); }
  delCompleted(key: string) { this.completed.delete(key); }
}

// ── a device ───────────────────────────────────────────────────────────
let idCounter = 0;
class Device {
  state: AppState;
  online = true;
  private firstCompletedFire = true;
  // Writes produced while offline, flushed on reconnect (Firestore queues).
  private queued: Array<() => void> = [];

  constructor(public name: string, public clockOffset: number, private cloud: Cloud) {
    this.state = {
      progress: CATEGORIES.map(c => ({ categoryId: c.id, bookIndex: 0, chapter: 1 })),
      settings: { theme: 'system', startDate: '', userName: '' },
      history: [],
      proverbJournals: [],
      customDevotionals: [],
      completedBooks: new Set<string>(),
    };
  }

  private dispatch(action: Parameters<typeof appReducer>[1]) {
    activeOffset = this.clockOffset;
    this.state = appReducer(this.state, action);
    activeOffset = 0;
  }

  private write(fn: () => void) {
    if (this.online) fn();
    else this.queued.push(fn);
  }

  // Faithful copy of useReadingActions.flush (advance path).
  advance(categoryId: string, amount: number) {
    activeOffset = this.clockOffset;
    const prog = this.state.progress.find(p => p.categoryId === categoryId)!;
    const { progress, newlyCompletedKeys, revertedCompletedKeys, historySteps } =
      calculateNextProgress(categoryId, amount, prog, this.state.completedBooks);
    activeOffset = 0;

    this.dispatch({ type: 'UPDATE_PROGRESS', categoryId, bookIndex: progress.bookIndex, chapter: progress.chapter });
    newlyCompletedKeys.forEach(key => this.dispatch({ type: 'TOGGLE_BOOK', key }));
    revertedCompletedKeys.forEach(key => this.dispatch({ type: 'TOGGLE_BOOK', key }));

    const cat = CATEGORIES_BY_ID.get(categoryId)!;
    const entries: HistoryEntry[] = historySteps.map((step, i) => ({
      id: `${this.name}_${idCounter++}_${i}`,
      timestamp: new RealDate(simNow + this.clockOffset).toISOString(),
      timestampMillis: simNow + this.clockOffset + i,
      localDate: '2026-01-01',
      categoryId,
      categoryName: cat.name,
      bookName: step.bookName,
      chapter: step.chapter,
      readTime: 1,
    }));
    entries.forEach(e => this.dispatch({ type: 'LOG_HISTORY', entry: e }));

    const newProg = this.state.progress.find(p => p.categoryId === categoryId)!;
    this.write(() => {
      this.cloud.writeProgress(newProg);
      this.cloud.writeHistory(entries);
      newlyCompletedKeys.forEach(k => { const [, b] = k.split(':'); this.cloud.setCompleted(`${categoryId}:${b}`); });
      // Mirrors useReadingActions.flush: a backward step un-completes the book
      // LOCALLY only. Pushing that delete to the cloud orphaned finished books,
      // because the backward step can lose the "furthest position wins" race
      // while its delete still landed. The local set re-syncs from the cloud.
    });
  }

  // Faithful copy of the Progress/History/Completed onSnapshot handlers,
  // including the reconciliation push-back.
  receiveSnapshot() {
    if (!this.online) return;
    // Progress (with PR #26 read-path: prefer stored updatedAtMillis).
    const progressArr: Progress[] = [...this.cloud.progress.values()].map(d => ({
      categoryId: d.categoryId,
      bookIndex: d.bookIndex,
      chapter: d.chapter,
      lastReadAt: d.lastReadAt,
      localDate: d.localDate,
      updatedAtMillis: d.updatedAtMillis || d.serverMillis,
    }));
    this.dispatch({ type: 'CLOUD_SYNC_PROGRESS', progress: progressArr });

    // Reconciliation push-back (useFirestoreSync.ts).
    const cloudMap = new Map(progressArr.map(p => [p.categoryId, p]));
    this.state.progress.forEach(localProg => {
      const cloudProg = cloudMap.get(localProg.categoryId);
      const winner = cloudProg ? resolveProgressConflict(localProg, cloudProg) : localProg;
      const cloudReflectsWinner = cloudProg &&
        winner.bookIndex === cloudProg.bookIndex && winner.chapter === cloudProg.chapter;
      if (!cloudReflectsWinner) this.write(() => this.cloud.writeProgress(winner));
    });

    // Completed books (with first-fire migration push-up, mirroring the hook).
    const cloudCompleted = [...this.cloud.completed];
    let effectiveCompleted = cloudCompleted;
    if (this.firstCompletedFire) {
      this.firstCompletedFire = false;
      const cloudSet = new Set(cloudCompleted);
      const missing = [...this.state.completedBooks].filter(k => !cloudSet.has(k));
      if (missing.length) {
        effectiveCompleted = [...cloudCompleted, ...missing];
        this.write(() => missing.forEach(k => this.cloud.setCompleted(k)));
      }
    }
    this.dispatch({ type: 'CLOUD_SYNC_COMPLETED', completed: effectiveCompleted });

    // History (sorted desc, like the orderBy query).
    const hist = [...this.cloud.history.values()].sort((a, b) => (b.timestampMillis || 0) - (a.timestampMillis || 0));
    this.dispatch({ type: 'CLOUD_SYNC_HISTORY', history: hist });
    const cloudIds = new Set(hist.map(h => h.id));
    const missing = this.state.history.filter(h => !cloudIds.has(h.id));
    if (missing.length) this.write(() => this.cloud.writeHistory(missing));
  }

  goOffline() { this.online = false; }
  goOnline() {
    this.online = true;
    const q = this.queued; this.queued = [];
    q.forEach(fn => fn());
  }
}

// ── propagate realtime snapshots until the system is stable ────────────
function settle(devices: Device[]) {
  for (let round = 0; round < 50; round++) {
    devices.forEach(d => d.receiveSnapshot());
  }
}

// ── invariant checks ────────────────────────────────────────────────────
let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) pass++; else { fail++; if (failures.length < 25) failures.push(`✗ ${name}`); }
}
const posKey = (p: Progress) => `${p.bookIndex}.${p.chapter}`;
const further = (a: Progress, b: Progress) =>
  a.bookIndex > b.bookIndex || (a.bookIndex === b.bookIndex && a.chapter >= b.chapter);

// ── scenario runner ─────────────────────────────────────────────────────
installClock();

// Scenario A: advance-only across devices with heavy clock skew + offline.
// Asserts CONVERGENCE and NO-REVERT (the reported bug).
for (let seed = 1; seed <= 400; seed++) {
  const r = rng(seed);
  const cloud = new Cloud();
  // Skews: iPad +2h ahead, phone -90min behind, Mac dead-on. Extreme on purpose.
  const devices = [
    new Device('iPad', 2 * 60 * 60 * 1000, cloud),
    new Device('phone', -90 * 60 * 1000, cloud),
    new Device('mac', 0, cloud),
  ];
  const furthestEver = new Map<string, Progress>();

  const ops = 30 + Math.floor(r() * 40);
  for (let i = 0; i < ops; i++) {
    simNow += 1000 + Math.floor(r() * 60_000);
    const d = devices[Math.floor(r() * devices.length)];
    const roll = r();
    if (roll < 0.15) d.goOffline();
    else if (roll < 0.3) d.goOnline();
    else {
      const cat = CATEGORIES[Math.floor(r() * CATEGORIES.length)].id;
      d.advance(cat, 1 + Math.floor(r() * 3));
      const p = d.state.progress.find(x => x.categoryId === cat)!;
      const prev = furthestEver.get(cat);
      if (!prev || further(p, prev)) furthestEver.set(cat, { ...p });
    }
    if (r() < 0.5) settle(devices);
  }
  devices.forEach(d => d.goOnline());
  settle(devices);

  // CONV: all devices agree with each other.
  const ref = devices[0].state.progress;
  for (const d of devices.slice(1)) {
    const ok = CATEGORIES.every(c => {
      const a = ref.find(p => p.categoryId === c.id)!;
      const b = d.state.progress.find(p => p.categoryId === c.id)!;
      return posKey(a) === posKey(b);
    });
    check(`A[seed ${seed}] converge ${d.name}==iPad`, ok);
  }
  // CONV: devices agree with the cloud.
  for (const d of devices) {
    const ok = CATEGORIES.every(c => {
      const local = d.state.progress.find(p => p.categoryId === c.id)!;
      const cp = cloud.progress.get(c.id);
      // A category never advanced has no cloud doc; local stays at 0.1.
      if (!cp) return local.bookIndex === 0 && local.chapter === 1;
      return cp.bookIndex === local.bookIndex && cp.chapter === local.chapter;
    });
    check(`A[seed ${seed}] cloud==${d.name}`, ok);
  }
  // NOREV: final position is at least the furthest ever reached.
  for (const [cat, furthest] of furthestEver) {
    const fin = devices[0].state.progress.find(p => p.categoryId === cat)!;
    check(`A[seed ${seed}] no-revert ${cat}`, further(fin, furthest));
  }
  // HIST: every created id survives in cloud (unless > cap) and no dupes.
  const allIds = new Set<string>();
  devices.forEach(d => d.state.history.forEach(h => allIds.add(h.id)));
  // device histories are deduped by id already (Map in reducer); just check
  // the cloud retains everything when under the cap.
  if (cloud.history.size <= HISTORY_CAP) {
    let survived = true;
    for (const id of allIds) if (!cloud.history.has(id)) { survived = false; break; }
    check(`A[seed ${seed}] history survives in cloud`, survived);
  }
}

// Scenario D: mixed FORWARD and BACKWARD advances, no jumps/resets.
//
// ORPHAN invariant: with only +/- stepping, reading never skips a book, so
// every book strictly before a category's final position must have been
// crossed — and therefore must be marked complete. This is the invariant the
// original suite lacked: a backward step on a device that was behind used to
// delete a finished book's completion in the cloud while losing the position
// race, so every device converged on the same WRONG state (past the book, book
// not complete) and the existing "devices agree" checks stayed green while the
// book's chapters silently vanished from the progress total.
for (let seed = 1; seed <= 300; seed++) {
  const r = rng(seed * 31 + 11);
  const cloud = new Cloud();
  const devices = [
    new Device('iPad', 2 * 60 * 60 * 1000, cloud),
    new Device('desktop', -45 * 60 * 1000, cloud),
  ];

  const ops = 40 + Math.floor(r() * 40);
  for (let i = 0; i < ops; i++) {
    simNow += 1000 + Math.floor(r() * 60_000);
    const d = devices[Math.floor(r() * devices.length)];
    const roll = r();
    if (roll < 0.12) d.goOffline();
    else if (roll < 0.26) d.goOnline();
    else {
      const cat = CATEGORIES[Math.floor(r() * CATEGORIES.length)].id;
      // Mostly forward, sometimes a backward step — the orphaning trigger.
      const amount = r() < 0.25 ? -1 : 1 + Math.floor(r() * 3);
      d.advance(cat, amount);
    }
    if (r() < 0.5) settle(devices);
  }
  devices.forEach(d => d.goOnline());
  settle(devices);

  for (const d of devices) {
    for (const cat of CATEGORIES) {
      const fin = d.state.progress.find(p => p.categoryId === cat.id)!;
      let intact = true;
      for (let i = 0; i < fin.bookIndex; i++) {
        if (!d.state.completedBooks.has(`${cat.id}:${cat.books[i].name}`)) { intact = false; break; }
      }
      check(`D[seed ${seed}] no orphaned completion ${cat.id} on ${d.name}`, intact);
    }
  }
}

// Scenario E: the orphaned-completion regression, deterministically.
//
// Both devices sit at Gospels/John 1 with Matthew, Mark and Luke complete.
// The iPad reads ahead to John 6. The desktop — which has not yet seen that —
// taps "−" once, stepping back across the boundary into Luke 24.
//
// Position resolution is "furthest wins", so both devices correctly converge on
// John 6 and the desktop's backward step loses. But the backward step used to
// ALSO push an unconditional cloud delete of Luke's completion, which did not
// lose the race. Both devices then agreed on: past Luke, Luke not complete —
// silently dropping Luke's 24 chapters from the progress total, permanently.
// Every pre-existing invariant (converge / no-revert / history) stayed green.
{
  const cloud = new Cloud();
  const ipad = new Device('iPad', 0, cloud);
  const desktop = new Device('desktop', 0, cloud);
  const devices = [ipad, desktop];

  const gospels = CATEGORIES_BY_ID.get('gospels')!;
  const upToJohn = gospels.books[0].chapters + gospels.books[1].chapters + gospels.books[2].chapters;

  simNow += 60_000;
  ipad.advance('gospels', upToJohn); // → John 1, Matthew+Mark+Luke complete
  settle(devices);

  const lukeKey = `gospels:${gospels.books[2].name}`;
  check('E precondition: Luke complete on both devices',
    devices.every(d => d.state.completedBooks.has(lukeKey)));
  check('E precondition: both at John 1',
    devices.every(d => {
      const p = d.state.progress.find(x => x.categoryId === 'gospels')!;
      return p.bookIndex === 3 && p.chapter === 1;
    }));

  // iPad reads ahead; desktop has not received that snapshot yet.
  simNow += 60_000;
  ipad.advance('gospels', 5); // → John 6
  simNow += 60_000;
  desktop.advance('gospels', -1); // steps back into Luke 24, un-completes Luke
  settle(devices);

  for (const d of devices) {
    const p = d.state.progress.find(x => x.categoryId === 'gospels')!;
    check(`E ${d.name} converged past Luke (John 6)`, p.bookIndex === 3 && p.chapter === 6);
    check(`E ${d.name} Luke still complete after losing the position race`,
      d.state.completedBooks.has(lukeKey));
  }
  check('E cloud still has Luke complete', cloud.completed.has(lukeKey));
}

// Scenario B: include backward jumps + resets; only CONVERGENCE is required
// (backward moves are not monotonic). Proves no crash / no divergence / no
// infinite push-back loop under mixed ops.
for (let seed = 1; seed <= 300; seed++) {
  const r = rng(seed * 7 + 3);
  const cloud = new Cloud();
  const devices = [
    new Device('A', Math.floor((r() - 0.5) * 4 * 60 * 60 * 1000), cloud),
    new Device('B', Math.floor((r() - 0.5) * 4 * 60 * 60 * 1000), cloud),
  ];

  const ops = 40 + Math.floor(r() * 40);
  for (let i = 0; i < ops; i++) {
    simNow += 1000 + Math.floor(r() * 120_000);
    const d = devices[Math.floor(r() * devices.length)];
    const roll = r();
    if (roll < 0.12) d.goOffline();
    else if (roll < 0.25) d.goOnline();
    else {
      const cat = CATEGORIES[Math.floor(r() * CATEGORIES.length)].id;
      // Mostly forward, occasionally a backward step (the "-" button).
      const amt = r() < 0.8 ? 1 + Math.floor(r() * 4) : -(1 + Math.floor(r() * 2));
      d.advance(cat, amt);
    }
    if (r() < 0.5) settle(devices);
  }
  devices.forEach(d => d.goOnline());
  settle(devices);

  const a = devices[0].state.progress, b = devices[1].state.progress;
  const converged = CATEGORIES.every(c =>
    posKey(a.find(p => p.categoryId === c.id)!) === posKey(b.find(p => p.categoryId === c.id)!));
  check(`B[seed ${seed}] mixed-ops converge`, converged);
  // completedBooks identical across devices.
  const ca = [...devices[0].state.completedBooks].sort().join(',');
  const cb = [...devices[1].state.completedBooks].sort().join(',');
  check(`B[seed ${seed}] completedBooks agree`, ca === cb);
}

restoreClock();

console.log(`\nSIM PASS ${pass} / ${pass + fail}`);
if (failures.length) { console.log(failures.join('\n')); }
if (fail > 0) process.exit(1);
console.log('All sync simulations green.');
