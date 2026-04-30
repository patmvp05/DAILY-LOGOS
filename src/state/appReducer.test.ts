import assert from 'node:assert';
import { test, describe } from 'node:test';
import { mergeAppState } from './appReducer.ts';
import { AppState } from '../types.ts';

function createMockState(): AppState {
  return {
    progress: [],
    settings: {
      startDate: '2024-01-01',
      theme: 'system',
    },
    history: [],
    proverbJournals: [],
    customDevotionals: [],
    completedBooks: new Set(),
  };
}

describe('mergeAppState', () => {
  test('returns a new object', () => {
    const current = createMockState();
    const result = mergeAppState(current, {});
    assert.notStrictEqual(result, current);
    assert.deepStrictEqual(result, current);
  });

  describe('history', () => {
    test('merges unique history entries by ID and sorts by timestampMillis descending', () => {
      const current = createMockState();
      current.history = [
        { id: '1', timestampMillis: 100, timestamp: '', categoryId: '', categoryName: '', bookName: '', chapter: 1 },
        { id: '2', timestampMillis: 200, timestamp: '', categoryId: '', categoryName: '', bookName: '', chapter: 1 },
      ];

      const incoming = {
        history: [
          { id: '2', timestampMillis: 250, timestamp: '', categoryId: '', categoryName: '', bookName: '', chapter: 2 }, // Updated timestamp
          { id: '3', timestampMillis: 300, timestamp: '', categoryId: '', categoryName: '', bookName: '', chapter: 1 },
        ]
      };

      const result = mergeAppState(current, incoming);
      assert.strictEqual(result.history.length, 3);
      assert.strictEqual(result.history[0].id, '3');
      assert.strictEqual(result.history[1].id, '2');
      assert.strictEqual(result.history[1].timestampMillis, 250); // Incoming overwrites local
      assert.strictEqual(result.history[2].id, '1');
    });

    test('does not overwrite non-empty local history with empty incoming history', () => {
      const current = createMockState();
      current.history = [
        { id: '1', timestampMillis: 100, timestamp: '', categoryId: '', categoryName: '', bookName: '', chapter: 1 }
      ];
      const result = mergeAppState(current, { history: [] });
      assert.strictEqual(result.history.length, 1);
      assert.strictEqual(result.history[0].id, '1');
    });

    test('caps history at 50 entries', () => {
      const current = createMockState();
      const incomingHistory = [];
      for (let i = 0; i < 60; i++) {
        incomingHistory.push({
          id: `id-${i}`,
          timestampMillis: i,
          timestamp: '',
          categoryId: '',
          categoryName: '',
          bookName: '',
          chapter: 1
        });
      }
      const result = mergeAppState(current, { history: incomingHistory });
      assert.strictEqual(result.history.length, 50);
      assert.strictEqual(result.history[0].id, 'id-59'); // Highest timestamp is first
      assert.strictEqual(result.history[49].id, 'id-10'); // Lowest timestamp is last
    });
  });

  describe('progress', () => {
    test('merges progress, preferring newer updates by updatedAtMillis', () => {
      const current = createMockState();
      current.progress = [
        { categoryId: 'cat1', bookIndex: 1, chapter: 1, updatedAtMillis: 100 },
        { categoryId: 'cat2', bookIndex: 1, chapter: 1, updatedAtMillis: 200 }
      ];

      const incoming = {
        progress: [
          { categoryId: 'cat1', bookIndex: 1, chapter: 2, updatedAtMillis: 150 }, // Newer
          { categoryId: 'cat2', bookIndex: 1, chapter: 2, updatedAtMillis: 150 }, // Older
          { categoryId: 'cat3', bookIndex: 1, chapter: 1, updatedAtMillis: 300 }  // New category
        ]
      };

      const result = mergeAppState(current, incoming);
      assert.strictEqual(result.progress.length, 3);

      const p1 = result.progress.find(p => p.categoryId === 'cat1');
      assert.strictEqual(p1?.chapter, 2); // Took incoming

      const p2 = result.progress.find(p => p.categoryId === 'cat2');
      assert.strictEqual(p2?.chapter, 1); // Kept local

      const p3 = result.progress.find(p => p.categoryId === 'cat3');
      assert.ok(p3); // Added new
    });

    test('falls back to lastReadAt if updatedAtMillis is absent', () => {
      const current = createMockState();
      current.progress = [
        { categoryId: 'cat1', bookIndex: 1, chapter: 1, lastReadAt: '2024-01-01T00:00:00.000Z' }
      ];
      const incoming = {
        progress: [
          { categoryId: 'cat1', bookIndex: 1, chapter: 2, lastReadAt: '2024-01-02T00:00:00.000Z' }
        ]
      };

      const result = mergeAppState(current, incoming);
      const p1 = result.progress.find(p => p.categoryId === 'cat1');
      assert.strictEqual(p1?.chapter, 2);
    });

    test('does not overwrite non-empty local progress with empty incoming progress', () => {
      const current = createMockState();
      current.progress = [
        { categoryId: 'cat1', bookIndex: 1, chapter: 1, updatedAtMillis: 100 }
      ];
      const result = mergeAppState(current, { progress: [] });
      assert.strictEqual(result.progress.length, 1);
    });
  });

  describe('completedBooks', () => {
    test('unions completedBooks', () => {
      const current = createMockState();
      current.completedBooks = new Set(['cat1:book1']);

      const incoming = {
        completedBooks: new Set(['cat1:book2'])
      };

      const result = mergeAppState(current, incoming);
      assert.strictEqual(result.completedBooks.size, 2);
      assert.ok(result.completedBooks.has('cat1:book1'));
      assert.ok(result.completedBooks.has('cat1:book2'));
    });

    test('does not overwrite non-empty local completedBooks with empty incoming', () => {
      const current = createMockState();
      current.completedBooks = new Set(['cat1:book1']);

      const incoming = {
        completedBooks: new Set<string>()
      };

      const result = mergeAppState(current, incoming);
      assert.strictEqual(result.completedBooks.size, 1);
      assert.ok(result.completedBooks.has('cat1:book1'));
    });

    test('handles incoming completedBooks as an Array instead of a Set', () => {
      const current = createMockState();
      current.completedBooks = new Set(['cat1:book1']);

      const incoming = {
        completedBooks: ['cat1:book2'] as any
      };

      const result = mergeAppState(current, incoming);
      assert.strictEqual(result.completedBooks.size, 2);
    });
  });

  describe('collections', () => {
    test('overwrites proverbJournals if incoming is not empty', () => {
      const current = createMockState();
      current.proverbJournals = [{ id: '1', date: '2024-01-01', chapter: 1, content: 'A' }];

      const incoming = {
        proverbJournals: [{ id: '2', date: '2024-01-02', chapter: 2, content: 'B' }]
      };

      const result = mergeAppState(current, incoming);
      assert.strictEqual(result.proverbJournals.length, 1);
      assert.strictEqual(result.proverbJournals[0].id, '2');
    });

    test('does not overwrite non-empty proverbJournals with empty incoming', () => {
      const current = createMockState();
      current.proverbJournals = [{ id: '1', date: '2024-01-01', chapter: 1, content: 'A' }];

      const result = mergeAppState(current, { proverbJournals: [] });
      assert.strictEqual(result.proverbJournals.length, 1);
      assert.strictEqual(result.proverbJournals[0].id, '1');
    });

    test('overwrites customDevotionals if incoming is not empty', () => {
      const current = createMockState();
      current.customDevotionals = [{ id: '1', name: 'A', description: 'A', url: 'http://a' }];

      const incoming = {
        customDevotionals: [{ id: '2', name: 'B', description: 'B', url: 'http://b' }]
      };

      const result = mergeAppState(current, incoming);
      assert.strictEqual(result.customDevotionals.length, 1);
      assert.strictEqual(result.customDevotionals[0].id, '2');
    });

    test('does not overwrite non-empty customDevotionals with empty incoming', () => {
      const current = createMockState();
      current.customDevotionals = [{ id: '1', name: 'A', description: 'A', url: 'http://a' }];

      const result = mergeAppState(current, { customDevotionals: [] });
      assert.strictEqual(result.customDevotionals.length, 1);
      assert.strictEqual(result.customDevotionals[0].id, '1');
    });
  });

  describe('settings', () => {
    test('merges settings individually', () => {
      const current = createMockState();
      current.settings = {
        startDate: '2024-01-01',
        theme: 'system',
        userName: 'User1'
      };

      const incoming = {
        settings: {
          startDate: '2024-02-01',
          theme: undefined as any,
          userName: 'User2'
        }
      };

      const result = mergeAppState(current, incoming);
      assert.strictEqual(result.settings.startDate, '2024-02-01');
      assert.strictEqual(result.settings.theme, 'system'); // Keeps local
      assert.strictEqual(result.settings.userName, 'User2');
    });
  });
});
