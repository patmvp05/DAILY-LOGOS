import test from 'node:test';
import assert from 'node:assert/strict';
import { generateJournalsMarkdown } from './export.ts';
import type { ProverbJournal } from '../types.ts';
import { format } from 'date-fns';

test('generateJournalsMarkdown', async (t) => {
  await t.test('returns empty string for empty journals list', () => {
    const result = generateJournalsMarkdown([]);
    assert.equal(result, '');
  });

  await t.test('generates correctly formatted markdown for single journal without verse', () => {
    const journals: ProverbJournal[] = [
      {
        id: '1',
        date: '2023-10-15',
        chapter: 15,
        content: 'This is a test reflection.',
      }
    ];

    const result = generateJournalsMarkdown(journals);

    const expectedExportDate = format(new Date(), 'PPPP');
    assert.ok(result.includes(`# Daily Logos - Proverb Journals\nExported on: ${expectedExportDate}\n\n`));
    assert.ok(result.includes(`## Proverbs 15 - Oct 15, 2023\n`));
    assert.ok(result.includes(`**Reflection:**\nThis is a test reflection.\n\n`));
    assert.ok(result.includes(`---\n\n`));
    assert.ok(!result.includes(`**Highlighted Verse:**`));
  });

  await t.test('generates correctly formatted markdown for single journal with verse', () => {
    const journals: ProverbJournal[] = [
      {
        id: '1',
        date: '2023-10-16',
        chapter: 16,
        content: 'Reflection on verse.',
        verse: 'Proverbs 16:1',
      }
    ];

    const result = generateJournalsMarkdown(journals);

    assert.ok(result.includes(`## Proverbs 16 - Oct 16, 2023\n`));
    assert.ok(result.includes(`**Highlighted Verse:** Proverbs 16:1\n\n`));
    assert.ok(result.includes(`**Reflection:**\nReflection on verse.\n\n`));
  });

  await t.test('sorts journals by date descending', () => {
    const journals: ProverbJournal[] = [
      {
        id: '1',
        date: '2023-10-10',
        chapter: 10,
        content: 'Older reflection.',
      },
      {
        id: '2',
        date: '2023-10-12',
        chapter: 12,
        content: 'Newer reflection.',
      }
    ];

    const result = generateJournalsMarkdown(journals);

    const newerIndex = result.indexOf('Oct 12, 2023');
    const olderIndex = result.indexOf('Oct 10, 2023');

    assert.ok(newerIndex !== -1, 'Newer date should be present');
    assert.ok(olderIndex !== -1, 'Older date should be present');
    assert.ok(newerIndex < olderIndex, 'Newer journal should appear before older journal');
  });
});
