/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests that opening the app does not ask for your location.
 *
 * The bug: WeatherWidget called navigator.geolocation whenever its saved
 * coordinates were over an hour old — on nearly every launch, and again on
 * every return to the app. An iPhone home-screen app forgets a location grant
 * each time it is closed, so the "would like to use your current location"
 * prompt appeared almost every time the app opened.
 *
 * The rule now (src/lib/weather.ts, resolveWeatherLocation): the browser is
 * asked for a position only on the very first run, or when the user taps the
 * weather. getPosition below stands in for navigator.geolocation — every call
 * to it is a prompt the user would have seen.
 *
 * Run with: npx tsx scripts/test-weather-location.mts
 */
import { readFileSync } from 'node:fs';
import {
  resolveWeatherLocation,
  loadSavedLocation,
  setManualLocation,
  DEFAULT_LOCATION,
  LOCATION_KEY,
  type LocationDeps,
} from '../src/lib/weather';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`✗ ${name}${detail ? ': ' + detail : ''}`); }
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
}

const GALLUP = { lat: 35.5281, lng: -108.7426 };

/** A fake device. `prompts` counts every time the browser would have asked. */
function device(opts: {
  storage?: ReturnType<typeof memoryStorage> | null;
  position?: { lat: number; lng: number } | 'denied';
  legacy?: { lat?: number; lng?: number; city?: string };
  city?: string;
} = {}) {
  const counts = { prompts: 0, legacyReads: 0 };
  // Each reading of the clock is six hours later, so the launches below span
  // days — an age limit on the saved location (the old one-hour rule) would
  // show up here as extra prompts.
  let clock = 1_700_000_000_000;
  const deps: LocationDeps = {
    storage: opts.storage === undefined ? memoryStorage() : opts.storage,
    getPosition: async () => {
      counts.prompts++;
      if (opts.position === 'denied' || !opts.position) throw new Error('User denied Geolocation');
      return opts.position;
    },
    reverseGeocode: async () => opts.city ?? 'Gallup',
    loadLegacy: async () => { counts.legacyReads++; return opts.legacy; },
    now: () => (clock += 6 * 60 * 60 * 1000),
  };
  return { deps, counts };
}

// ── First run asks once; every launch after that never asks
{
  const { deps, counts } = device({ position: GALLUP });
  const first = await resolveWeatherLocation({}, deps);
  ok('first run asks for the location once', counts.prompts === 1, `asked ${counts.prompts}x`);
  ok('first run saves the device position', first.lat === GALLUP.lat && first.source === 'gps');
  ok('first run names the place', first.city === 'Gallup');

  for (let i = 0; i < 30; i++) await resolveWeatherLocation({}, deps);
  ok('30 more launches never ask again', counts.prompts === 1, `asked ${counts.prompts}x`);

  const again = await resolveWeatherLocation({}, deps);
  ok('later launches use the saved spot', again.lat === GALLUP.lat && again.city === 'Gallup');
}

// ── Two refreshes at once on a first launch share one request
{
  // Mount + visibilitychange (or StrictMode's double effect) can both fire
  // before the first answer comes back.
  const { deps, counts } = device({ position: GALLUP });
  const [a, b] = await Promise.all([
    resolveWeatherLocation({}, deps),
    resolveWeatherLocation({}, deps),
  ]);
  ok('concurrent first-run refreshes ask only once', counts.prompts === 1, `asked ${counts.prompts}x`);
  ok('both get the same answer', a.lat === b.lat && a.city === b.city);
}

// ── Saying "Don't Allow" on the first run is remembered too
{
  const { deps, counts } = device({ position: 'denied' });
  const first = await resolveWeatherLocation({}, deps);
  ok('a refused first run falls back to the default city',
     first.lat === DEFAULT_LOCATION.lat && first.city === DEFAULT_LOCATION.city);
  ok('the fallback is saved as the default', first.source === 'default');
  for (let i = 0; i < 10; i++) await resolveWeatherLocation({}, deps);
  ok('a refusal is not followed by a prompt on every launch', counts.prompts === 1,
     `asked ${counts.prompts}x`);
}

// ── Existing installs: the old IndexedDB coordinates carry over, no prompt
{
  const { deps, counts } = device({ position: GALLUP, legacy: { lat: 10.78, lng: 106.7, city: 'Thu Duc' } });
  const loc = await resolveWeatherLocation({}, deps);
  ok('an existing install is not asked after the update', counts.prompts === 0,
     `asked ${counts.prompts}x`);
  ok('it keeps the coordinates it already had', loc.lat === 10.78 && loc.city === 'Thu Duc');
  await resolveWeatherLocation({}, deps);
  ok('the migration happens once (then reads the new key)', counts.legacyReads === 1,
     `read legacy ${counts.legacyReads}x`);
}

{
  const { deps, counts } = device({ legacy: { lat: 10.78, lng: 106.7 }, city: 'Thu Duc' });
  const loc = await resolveWeatherLocation({}, deps);
  ok('a legacy entry without a city gets one by lookup, not by prompt',
     counts.prompts === 0 && loc.city === 'Thu Duc');
}

{
  const { deps, counts } = device({ position: GALLUP, legacy: { city: 'broken' } });
  await resolveWeatherLocation({}, deps);
  ok('a legacy entry with no coordinates is ignored (treated as first run)', counts.prompts === 1);
}

// ── Tapping the weather is the one other time it asks
{
  const storage = memoryStorage();
  const before = device({ storage, position: 'denied' });
  await resolveWeatherLocation({}, before.deps); // first run, refused -> default

  const tap = device({ storage, position: GALLUP });
  const loc = await resolveWeatherLocation({ locate: true }, tap.deps);
  ok('a tap asks for the location', tap.counts.prompts === 1);
  ok('a tap moves the weather to where you are', loc.lat === GALLUP.lat && loc.source === 'gps');
  await resolveWeatherLocation({}, tap.deps);
  ok('the next launch keeps the tapped location without asking',
     tap.counts.prompts === 1 && loadSavedLocation(storage)?.lat === GALLUP.lat);

  const refused = device({ storage, position: 'denied' });
  const kept = await resolveWeatherLocation({ locate: true }, refused.deps);
  ok('a refused tap keeps the location you had (not the default)',
     kept.lat === GALLUP.lat && kept.source === 'gps');
}

// ── A typed-in city is never overridden by a launch
{
  const storage = memoryStorage();
  setManualLocation(40.7128, -74.006, 'New York', storage);
  const { deps, counts } = device({ storage, position: GALLUP });
  for (let i = 0; i < 5; i++) await resolveWeatherLocation({}, deps);
  const loc = loadSavedLocation(storage);
  ok('a manual city survives launches', loc?.city === 'New York' && loc?.source === 'manual');
  ok('…without asking', counts.prompts === 0);
}

// ── Storage trouble degrades instead of throwing
{
  const corrupt = memoryStorage({ [LOCATION_KEY]: '{not json' });
  const { deps } = device({ storage: corrupt, position: GALLUP });
  const loc = await resolveWeatherLocation({}, deps);
  ok('corrupt saved data is treated as missing', loc.lat === GALLUP.lat);

  const throwing = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
  };
  let threw = false;
  try {
    const d = device({ position: GALLUP });
    d.deps.storage = throwing;
    await resolveWeatherLocation({}, d.deps);
  } catch { threw = true; }
  ok('blocked storage does not throw', !threw);

  const none = device({ storage: null, position: 'denied' });
  const fallback = await resolveWeatherLocation({}, none.deps);
  ok('no storage at all still shows the default city', fallback.city === DEFAULT_LOCATION.city);
}

// ── The widget can't sneak a prompt back in
{
  const widget = readFileSync(new URL('../src/components/WeatherWidget.tsx', import.meta.url), 'utf8');
  ok('WeatherWidget never calls navigator.geolocation itself',
     !widget.includes('navigator.geolocation'),
     'all location requests must go through resolveWeatherLocation');

  const effect = /useEffect\(\(\) => \{([\s\S]*?)\}, \[refresh\]\);/.exec(widget);
  ok('the launch/visibility effect is found', !!effect);
  ok('launching or returning to the app never passes locate',
     !!effect && !effect[1].includes('locate'),
     'only a tap on the weather may ask for the location');

  const locateCalls = (widget.match(/refresh\(\{ locate: true \}\)/g) ?? []).length;
  ok('exactly one place requests a fresh location (the tap handler)', locateCalls === 1,
     `found ${locateCalls}`);
  ok('that place is the tap handler', /const updateLocation = \(\) => \{[\s\S]*?refresh\(\{ locate: true \}\)/.test(widget));

  const lib = readFileSync(new URL('../src/lib/weather.ts', import.meta.url), 'utf8');
  ok('the saved location has no expiry check',
     !/savedAt\s*[<>]|Date\.now\(\)\s*-\s*\w*\.savedAt/.test(lib),
     'an age limit on the location is exactly what re-prompted every hour');
}

console.log('');
if (fail === 0) {
  console.log(`WEATHER-LOCATION PASS ${pass} / ${pass}`);
} else {
  console.log(`WEATHER-LOCATION FAIL ${fail} / ${pass + fail}`);
  failures.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
