import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { appReducer } from '../appReducer';
import { AppState, AppAction, Progress } from '../../types';

describe('appReducer', () => {
  const initialState: AppState = {
    progress: [],
    settings: {
      startDate: '2023-01-01',
      theme: 'system'
    },
    history: [],
    proverbJournals: [],
    customDevotionals: [],
    completedBooks: new Set()
  };

  test('REPLACE_STATE completely replaces the state', () => {
    const newStateData: Partial<AppState> = {
      progress: [{ categoryId: 'bible', bookIndex: 0, chapter: 1 }],
      settings: { startDate: '2024-01-01', theme: 'dark' }
    };

    // REPLACE_STATE type allows full AppState, let's cast
    const newState = appReducer(initialState, { type: 'REPLACE_STATE', state: { ...initialState, ...newStateData } as AppState });

    assert.deepEqual(newState.progress, newStateData.progress);
    assert.equal(newState.settings.startDate, '2024-01-01');
    assert.equal(newState.settings.theme, 'dark');
  });

  test('HYDRATE_STATE merges state correctly', () => {
    const currentState: AppState = {
      ...initialState,
      settings: { startDate: '2023-01-01', theme: 'light' },
      progress: [{ categoryId: 'bible', bookIndex: 0, chapter: 1 }]
    };

    const action: AppAction = {
      type: 'HYDRATE_STATE',
      state: {
        settings: { startDate: '2024-01-01', theme: 'dark' },
        progress: [{ categoryId: 'bible', bookIndex: 1, chapter: 2, updatedAtMillis: Date.now() }]
      },
      restoredFromSnapshot: true
    };

    const newState = appReducer(currentState, action);

    assert.equal(newState.settings.theme, 'dark');
    assert.equal(newState.settings.startDate, '2024-01-01');
    assert.equal(newState.restoredFromSnapshot, true);
    // Because the incoming progress is newer, it should update or add
    // AppReducer logic uses cloudMap and updates local if cloud is newer
    // Or adds if it doesn't exist
    // Since categoryId 'bible' exists locally, it updates local with newer timestamp
    assert.equal(newState.progress[0].bookIndex, 1);
    assert.equal(newState.progress[0].chapter, 2);
  });

  test('UPDATE_PROGRESS modifies specific category progress', () => {
    const currentState: AppState = {
      ...initialState,
      progress: [{ categoryId: 'bible', bookIndex: 0, chapter: 1 }]
    };

    const newState = appReducer(currentState, {
      type: 'UPDATE_PROGRESS',
      categoryId: 'bible',
      bookIndex: 0,
      chapter: 2
    });

    assert.equal(newState.progress.length, 1);
    assert.equal(newState.progress[0].chapter, 2);
    assert.ok(newState.progress[0].lastReadAt);
    assert.ok(newState.progress[0].updatedAtMillis);
  });

  test('TOGGLE_BOOK adds and removes from completedBooks', () => {
    // Add book
    let newState = appReducer(initialState, {
      type: 'TOGGLE_BOOK',
      key: 'bible:Genesis'
    });
    assert.ok(newState.completedBooks.has('bible:Genesis'));

    // Remove book
    newState = appReducer(newState, {
      type: 'TOGGLE_BOOK',
      key: 'bible:Genesis'
    });
    assert.ok(!newState.completedBooks.has('bible:Genesis'));
  });

  test('CLOUD_SYNC_PROGRESS uses newer cloud progress', () => {
    const now = Date.now();
    const currentState: AppState = {
      ...initialState,
      progress: [
        { categoryId: 'bible', bookIndex: 0, chapter: 1, updatedAtMillis: now - 1000 }
      ]
    };

    const cloudProgress: Progress[] = [
      { categoryId: 'bible', bookIndex: 0, chapter: 5, updatedAtMillis: now }
    ];

    const newState = appReducer(currentState, {
      type: 'CLOUD_SYNC_PROGRESS',
      progress: cloudProgress
    });

    assert.equal(newState.progress[0].chapter, 5);
  });

  test('CLOUD_SYNC_PROGRESS ignores older cloud progress', () => {
    const now = Date.now();
    const currentState: AppState = {
      ...initialState,
      progress: [
        { categoryId: 'bible', bookIndex: 0, chapter: 5, updatedAtMillis: now }
      ]
    };

    const cloudProgress: Progress[] = [
      { categoryId: 'bible', bookIndex: 0, chapter: 1, updatedAtMillis: now - 1000 }
    ];

    const newState = appReducer(currentState, {
      type: 'CLOUD_SYNC_PROGRESS',
      progress: cloudProgress
    });

    assert.equal(newState.progress[0].chapter, 5);
    // Should be exact same object reference if unchanged
    assert.equal(newState, currentState);
  });

  test('CLOUD_SYNC_HISTORY correctly merges and limits history', () => {
    const currentState: AppState = {
      ...initialState,
      history: [
        { id: '1', categoryId: 'bible', categoryName: 'Bible', bookName: 'Genesis', chapter: 1, timestamp: '2023-01-01', timestampMillis: 1000 }
      ]
    };

    const newState = appReducer(currentState, {
      type: 'CLOUD_SYNC_HISTORY',
      history: [
        { id: '2', categoryId: 'bible', categoryName: 'Bible', bookName: 'Genesis', chapter: 2, timestamp: '2023-01-02', timestampMillis: 2000 },
        { id: '1', categoryId: 'bible', categoryName: 'Bible', bookName: 'Genesis', chapter: 1, timestamp: '2023-01-01', timestampMillis: 1000 } // Duplicate to check deduplication
      ]
    });

    assert.equal(newState.history.length, 2);
    assert.equal(newState.history[0].id, '2'); // Ordered by timestampMillis descending
    assert.equal(newState.history[1].id, '1');
  });

  test('LOG_HISTORY sorts out of order history', () => {
    const currentState: AppState = {
      ...initialState,
      history: [
        { id: '2', categoryId: 'bible', categoryName: 'Bible', bookName: 'Genesis', chapter: 2, timestamp: '2023-01-02', timestampMillis: 2000 }
      ]
    };

    const newState = appReducer(currentState, {
      type: 'LOG_HISTORY',
      entry: { id: '1', categoryId: 'bible', categoryName: 'Bible', bookName: 'Genesis', chapter: 1, timestamp: '2023-01-01', timestampMillis: 1000 }
    });

    // It should push it to the top but detect it's older than the next, so it resorts descending
    assert.equal(newState.history[0].id, '2');
    assert.equal(newState.history[1].id, '1');
  });
});
