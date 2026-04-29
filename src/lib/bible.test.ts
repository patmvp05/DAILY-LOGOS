import { test, describe } from 'node:test';
import assert from 'node:assert';
import { CATEGORIES_BY_ID } from '../constants.ts';
import { calculateNextProgress } from './bible.ts';

describe('calculateNextProgress', () => {
  const categoryId = 'law'; // Genesis (50 chapters), Exodus (40 chapters)
  const completedBooks = new Set<string>();

  test('should move forward within the same book', () => {
    const currentProgress = {
      categoryId,
      bookIndex: 0, // Genesis
      chapter: 1,
    };

    const result = calculateNextProgress(categoryId, 5, currentProgress, completedBooks);

    assert.strictEqual(result.progress.bookIndex, 0);
    assert.strictEqual(result.progress.chapter, 6);
    assert.strictEqual(result.newlyCompletedKeys.length, 0);
    assert.strictEqual(result.historySteps.length, 5);
    assert.strictEqual(result.historySteps[0].chapter, 1);
    assert.strictEqual(result.historySteps[4].chapter, 5);
  });

  test('should move forward to the next book', () => {
    const currentProgress = {
      categoryId,
      bookIndex: 0, // Genesis (50 chapters)
      chapter: 48,
    };

    const result = calculateNextProgress(categoryId, 5, currentProgress, completedBooks);

    assert.strictEqual(result.progress.bookIndex, 1); // Exodus
    assert.strictEqual(result.progress.chapter, 3);
    assert.deepStrictEqual(result.newlyCompletedKeys, ['law:Genesis']);
  });

  test('should stay at the last chapter of the last book when moving past the end', () => {
    const currentProgress = {
      categoryId: 'psalms', // Psalms (1 book, 150 chapters)
      bookIndex: 0,
      chapter: 148,
    };

    const result = calculateNextProgress('psalms', 10, currentProgress, completedBooks);

    assert.strictEqual(result.progress.bookIndex, 0);
    assert.strictEqual(result.progress.chapter, 150);
    assert.deepStrictEqual(result.newlyCompletedKeys, ['psalms:Psalms']);
  });

  test('should move backward within the same book', () => {
    const currentProgress = {
      categoryId,
      bookIndex: 0,
      chapter: 10,
    };

    const result = calculateNextProgress(categoryId, -5, currentProgress, completedBooks);

    assert.strictEqual(result.progress.bookIndex, 0);
    assert.strictEqual(result.progress.chapter, 5);
  });

  test('should move backward to the previous book', () => {
    const currentProgress = {
      categoryId,
      bookIndex: 1, // Exodus
      chapter: 2,
    };

    const result = calculateNextProgress(categoryId, -5, currentProgress, completedBooks);

    assert.strictEqual(result.progress.bookIndex, 0); // Genesis
    assert.strictEqual(result.progress.chapter, 47);
  });

  test('should stay at the first chapter of the first book when moving before the start', () => {
    const currentProgress = {
      categoryId,
      bookIndex: 0,
      chapter: 3,
    };

    const result = calculateNextProgress(categoryId, -10, currentProgress, completedBooks);

    assert.strictEqual(result.progress.bookIndex, 0);
    assert.strictEqual(result.progress.chapter, 1);
  });

  test('should not add to newlyCompletedKeys if book was already completed', () => {
    const currentProgress = {
      categoryId,
      bookIndex: 0,
      chapter: 50,
    };
    const completed = new Set(['law:Genesis']);

    const result = calculateNextProgress(categoryId, 1, currentProgress, completed);

    assert.strictEqual(result.progress.bookIndex, 1);
    assert.strictEqual(result.progress.chapter, 1);
    assert.strictEqual(result.newlyCompletedKeys.length, 0);
  });
});
