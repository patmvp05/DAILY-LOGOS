/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the navbar sync-status rules.
 *
 * The bug these guard: a single failed write latched the badge to red for the
 * rest of the session, because the ONLY thing that cleared it was a later
 * successful write. Someone who was just reading saw a permanent "Sync Error"
 * for a problem that had already resolved.
 *
 * Run with: npx tsx scripts/test-sync-status.mts
 */
import { syncTracker, recordSyncError, getLastSyncError, describeSyncError } from '../src/lib/syncStatus';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

/** Subscribe and record every status emitted; returns the latest. */
function watch() {
  const seen: string[] = [];
  const unsub = syncTracker.subscribe((s) => seen.push(s));
  return { seen, unsub, last: () => seen[seen.length - 1] };
}

// ── A transient failure must not latch.
{
  syncTracker._reset();
  const w = watch();
  syncTracker.begin();
  recordSyncError('writeActionBatch', { code: 'unavailable', message: 'backend unreachable' });
  syncTracker.end(false, 'unavailable');
  ok('transient failure shows error', w.last() === 'error', w.last());

  // A snapshot proves the connection came back.
  syncTracker.noteHealthyTraffic();
  ok('transient error clears once traffic is healthy again', w.last() === 'synced', w.last());
  ok('transient error is forgotten', getLastSyncError() === null);
  w.unsub();
}

// ── A terminal failure must persist: that data really did not save.
{
  syncTracker._reset();
  const w = watch();
  syncTracker.begin();
  recordSyncError('writeSprintHour', { code: 'permission-denied', message: 'Missing permissions' });
  syncTracker.end(false, 'permission-denied');
  ok('terminal failure shows error', w.last() === 'error', w.last());

  syncTracker.noteHealthyTraffic();
  ok('terminal error is NOT cleared by healthy traffic', w.last() === 'error', w.last());
  ok('terminal error is retained for the report',
     getLastSyncError()?.code === 'permission-denied');
  w.unsub();
}

// ── A later successful write clears everything, terminal or not.
{
  syncTracker._reset();
  const w = watch();
  syncTracker.begin();
  recordSyncError('writeSprintHour', { code: 'permission-denied', message: 'nope' });
  syncTracker.end(false, 'permission-denied');
  ok('still red before the retry', w.last() === 'error');

  syncTracker.begin();
  syncTracker.end(true);
  ok('a successful write clears the error', w.last() === 'synced', w.last());
  ok('and clears the recorded failure', getLastSyncError() === null);
  w.unsub();
}

// ── inflight accounting
{
  syncTracker._reset();
  const w = watch();
  syncTracker.begin();
  ok('one write in flight -> syncing', w.last() === 'syncing', w.last());
  syncTracker.begin();
  syncTracker.end(true);
  ok('still syncing while a second write is in flight', w.last() === 'syncing', w.last());
  syncTracker.end(true);
  ok('settles to synced when the last write finishes', w.last() === 'synced', w.last());

  // end() must never drive inflight negative and wedge the badge.
  syncTracker.end(true);
  syncTracker.end(true);
  syncTracker.begin();
  ok('extra end() calls cannot wedge the status', w.last() === 'syncing', w.last());
  w.unsub();
}

// ── noteHealthyTraffic must not stomp an in-flight write
{
  syncTracker._reset();
  const w = watch();
  syncTracker.begin();
  syncTracker.noteHealthyTraffic();
  ok('healthy traffic does not report synced while a write is pending',
     w.last() === 'syncing', w.last());
  syncTracker.end(true);
  w.unsub();
}

// ── The message shown to the user
{
  ok('describes a permission failure with a hint',
     describeSyncError({ operation: 'writeSprintHour', code: 'permission-denied', message: 'x', at: '' })
       .includes('rules'));
  ok('describes an unreachable backend',
     describeSyncError({ operation: 'writeActionBatch', code: 'unavailable', message: 'x', at: '' })
       .includes('could not reach'));
  ok('names the failing operation',
     describeSyncError({ operation: 'writeJournal', code: 'unknown', message: 'x', at: '' })
       .startsWith('writeJournal failed'));
  ok('no error -> empty string', describeSyncError(null) === '');
}

// ── recordSyncError tolerates junk
{
  recordSyncError('op', new Error('boom'));
  ok('plain Error -> unknown code', getLastSyncError()?.code === 'unknown');
  ok('plain Error keeps its message', getLastSyncError()?.message === 'boom');
  recordSyncError('op', 'a string');
  ok('non-Error input does not crash', getLastSyncError()?.message === 'a string');
  recordSyncError('op', { code: 'unavailable', message: 'y'.repeat(1000) });
  ok('message is bounded', (getLastSyncError()?.message.length ?? 0) <= 300);
}

console.log('');
if (fail === 0) {
  console.log(`SYNC-STATUS PASS ${pass} / ${pass}`);
} else {
  console.log(`SYNC-STATUS FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
