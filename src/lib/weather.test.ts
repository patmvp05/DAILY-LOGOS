import test from 'node:test';
import assert from 'node:assert';
import { getCachedWeather } from './weather.ts';

// Mock localStorage
const mockLocalStorage = {
  store: {} as Record<string, string>,
  getItem(key: string) {
    return this.store[key] || null;
  },
  setItem(key: string, value: string) {
    this.store[key] = value;
  },
  clear() {
    this.store = {};
  }
};

(globalThis as any).localStorage = mockLocalStorage;

const CACHE_KEY = 'dl_weather_v1';

test('getCachedWeather handles missing cache', () => {
  mockLocalStorage.clear();
  const result = getCachedWeather();
  assert.strictEqual(result, null);
});

test('getCachedWeather handles invalid JSON cache gracefully', () => {
  mockLocalStorage.clear();
  mockLocalStorage.setItem(CACHE_KEY, 'invalid json');
  const result = getCachedWeather();
  assert.strictEqual(result, null);
});

test('getCachedWeather discards expired cache', () => {
  mockLocalStorage.clear();
  const now = Date.now();
  const snapshot = { tempF: 75, city: 'HCMC' };

  // Set to 6 hours and 1 millisecond ago
  const ts = now - (1000 * 60 * 60 * 6 + 1);
  mockLocalStorage.setItem(CACHE_KEY, JSON.stringify({ snapshot, ts }));

  const result = getCachedWeather();
  assert.strictEqual(result, null);
});

test('getCachedWeather returns valid cache', () => {
  mockLocalStorage.clear();
  const now = Date.now();
  const snapshot = { tempF: 75, city: 'HCMC' };

  // Set to 5 hours ago
  const ts = now - (1000 * 60 * 60 * 5);
  mockLocalStorage.setItem(CACHE_KEY, JSON.stringify({ snapshot, ts }));

  const result = getCachedWeather();
  assert.deepStrictEqual(result, snapshot);
});

test('getCachedWeather handles exceptions when accessing localStorage', () => {
  mockLocalStorage.clear();

  const originalGetItem = mockLocalStorage.getItem;
  mockLocalStorage.getItem = () => {
    throw new Error('Access Denied');
  };

  const result = getCachedWeather();
  assert.strictEqual(result, null);

  mockLocalStorage.getItem = originalGetItem;
});
