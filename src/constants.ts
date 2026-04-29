/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Book {
  name: string;
  chapters: number;
}

export interface Category {
  id: string;
  name: string;
  books: Book[];
  color: string;
}

export const CATEGORIES: Category[] = [
  {
    id: 'law',
    name: 'The Law',
    color: '#000000',
    books: [
      { name: 'Genesis', chapters: 50 },
      { name: 'Exodus', chapters: 40 },
      { name: 'Leviticus', chapters: 27 },
      { name: 'Numbers', chapters: 36 },
      { name: 'Deuteronomy', chapters: 34 },
    ],
  },
  {
    id: 'history',
    name: 'History',
    color: '#000000',
    books: [
      { name: 'Joshua', chapters: 24 },
      { name: 'Judges', chapters: 21 },
      { name: 'Ruth', chapters: 4 },
      { name: '1 Samuel', chapters: 31 },
      { name: '2 Samuel', chapters: 24 },
      { name: '1 Kings', chapters: 22 },
      { name: '2 Kings', chapters: 25 },
      { name: '1 Chronicles', chapters: 29 },
      { name: '2 Chronicles', chapters: 36 },
      { name: 'Ezra', chapters: 10 },
      { name: 'Nehemiah', chapters: 13 },
      { name: 'Esther', chapters: 10 },
    ],
  },
  {
    id: 'gospels',
    name: 'Gospels',
    color: '#000000',
    books: [
      { name: 'Matthew', chapters: 28 },
      { name: 'Mark', chapters: 16 },
      { name: 'Luke', chapters: 24 },
      { name: 'John', chapters: 21 },
      { name: 'Acts', chapters: 28 },
    ],
  },
  {
    id: 'wisdom',
    name: 'Wisdom',
    color: '#000000',
    books: [
      { name: 'Job', chapters: 42 },
      { name: 'Proverbs', chapters: 31 },
      { name: 'Ecclesiastes', chapters: 12 },
      { name: 'Song of Solomon', chapters: 8 },
    ],
  },
  {
    id: 'epistles',
    name: 'Epistles',
    color: '#000000',
    books: [
      { name: 'Romans', chapters: 16 },
      { name: '1 Corinthians', chapters: 16 },
      { name: '2 Corinthians', chapters: 13 },
      { name: 'Galatians', chapters: 6 },
      { name: 'Ephesians', chapters: 6 },
      { name: 'Philippians', chapters: 4 },
      { name: 'Colossians', chapters: 4 },
      { name: '1 Thessalonians', chapters: 5 },
      { name: '2 Thessalonians', chapters: 3 },
      { name: '1 Timothy', chapters: 6 },
      { name: '2 Timothy', chapters: 4 },
      { name: 'Titus', chapters: 3 },
      { name: 'Philemon', chapters: 1 },
      { name: 'Hebrews', chapters: 13 },
      { name: 'James', chapters: 5 },
      { name: '1 Peter', chapters: 5 },
      { name: '2 Peter', chapters: 3 },
      { name: '1 John', chapters: 5 },
      { name: '2 John', chapters: 1 },
      { name: '3 John', chapters: 1 },
      { name: 'Jude', chapters: 1 },
    ],
  },
  {
    id: 'prophecy',
    name: 'Prophecy',
    color: '#000000',
    books: [
      { name: 'Isaiah', chapters: 66 },
      { name: 'Jeremiah', chapters: 52 },
      { name: 'Lamentations', chapters: 5 },
      { name: 'Ezekiel', chapters: 48 },
      { name: 'Daniel', chapters: 12 },
      { name: 'Hosea', chapters: 14 },
      { name: 'Joel', chapters: 3 },
      { name: 'Amos', chapters: 9 },
      { name: 'Obadiah', chapters: 1 },
      { name: 'Jonah', chapters: 4 },
      { name: 'Micah', chapters: 7 },
      { name: 'Nahum', chapters: 3 },
      { name: 'Habakkuk', chapters: 3 },
      { name: 'Zephaniah', chapters: 3 },
      { name: 'Haggai', chapters: 2 },
      { name: 'Zechariah', chapters: 14 },
      { name: 'Malachi', chapters: 4 },
      { name: 'Revelation', chapters: 22 },
    ],
  },
  {
    id: 'psalms',
    name: 'Psalms',
    color: '#000000',
    books: [
      { name: 'Psalms', chapters: 150 },
    ],
  },
];

export const CATEGORIES_BY_ID = new Map(CATEGORIES.map(c => [c.id, c]));

export const BOLLS_BIBLE_BOOK_IDS: Record<string, number> = {
  'Genesis': 1, 'Exodus': 2, 'Leviticus': 3, 'Numbers': 4, 'Deuteronomy': 5,
  'Joshua': 6, 'Judges': 7, 'Ruth': 8, '1 Samuel': 9, '2 Samuel': 10,
  '1 Kings': 11, '2 Kings': 12, '1 Chronicles': 13, '2 Chronicles': 14,
  'Ezra': 15, 'Nehemiah': 16, 'Esther': 17, 'Job': 18, 'Psalms': 19,
  'Proverbs': 20, 'Ecclesiastes': 21, 'Song of Solomon': 22, 'Isaiah': 23,
  'Jeremiah': 24, 'Lamentations': 25, 'Ezekiel': 26, 'Daniel': 27,
  'Hosea': 28, 'Joel': 29, 'Amos': 30, 'Obadiah': 31, 'Jonah': 32,
  'Micah': 33, 'Nahum': 34, 'Habakkuk': 35, 'Zephaniah': 36, 'Haggai': 37,
  'Zechariah': 38, 'Malachi': 39, 'Matthew': 40, 'Mark': 41, 'Luke': 42,
  'John': 43, 'Acts': 44, 'Romans': 45, '1 Corinthians': 46, '2 Corinthians': 47,
  'Galatians': 48, 'Ephesians': 49, 'Philippians': 50, 'Colossians': 51,
  '1 Thessalonians': 52, '2 Thessalonians': 53, '1 Timothy': 54, '2 Timothy': 55,
  'Titus': 56, 'Philemon': 57, 'Hebrews': 58, 'James': 59, '1 Peter': 60,
  '2 Peter': 61, '1 John': 62, '2 John': 63, '3 John': 64, 'Jude': 65,
  'Revelation': 66
};

export const DEFAULT_BOOK_MINUTES = 4; // fallback if a book isn't in the map

export const BOOK_READ_MINUTES: Record<string, number> = {
  // The Law
  'Genesis': 5, 'Exodus': 5, 'Leviticus': 4, 'Numbers': 5, 'Deuteronomy': 5,
  // History
  'Joshua': 4, 'Judges': 5, 'Ruth': 3,
  '1 Samuel': 5, '2 Samuel': 5, '1 Kings': 5, '2 Kings': 5,
  '1 Chronicles': 5, '2 Chronicles': 5, 'Ezra': 4, 'Nehemiah': 5, 'Esther': 4,
  // Gospels (incl. Acts)
  'Matthew': 4, 'Mark': 4, 'Luke': 5, 'John': 4, 'Acts': 5,
  // Wisdom
  'Job': 3, 'Proverbs': 3, 'Ecclesiastes': 3, 'Song of Solomon': 2,
  // Epistles
  'Romans': 4, '1 Corinthians': 4, '2 Corinthians': 3, 'Galatians': 3,
  'Ephesians': 3, 'Philippians': 3, 'Colossians': 3,
  '1 Thessalonians': 2, '2 Thessalonians': 2,
  '1 Timothy': 2, '2 Timothy': 2, 'Titus': 2, 'Philemon': 2,
  'Hebrews': 4, 'James': 3, '1 Peter': 3, '2 Peter': 2,
  '1 John': 2, '2 John': 1, '3 John': 1, 'Jude': 2,
  // Prophecy
  'Isaiah': 4, 'Jeremiah': 5, 'Lamentations': 3, 'Ezekiel': 5, 'Daniel': 5,
  'Hosea': 3, 'Joel': 3, 'Amos': 3, 'Obadiah': 3, 'Jonah': 3,
  'Micah': 3, 'Nahum': 3, 'Habakkuk': 3, 'Zephaniah': 3,
  'Haggai': 3, 'Zechariah': 3, 'Malachi': 3,
  'Revelation': 4,
  // Psalms
  'Psalms': 2,
};
