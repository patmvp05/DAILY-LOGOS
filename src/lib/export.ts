/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { format, parseISO } from 'date-fns';
import type { ProverbJournal } from '../types.ts';

export const generateJournalsMarkdown = (journals: ProverbJournal[]): string => {
  if (journals.length === 0) return '';

  let md = `# Daily Logos - Proverb Journals\nExported on: ${format(new Date(), 'PPPP')}\n\n`;
  
  const sorted = [...journals].sort((a, b) => b.date.localeCompare(a.date));
  
  sorted.forEach(j => {
    md += `## Proverbs ${j.chapter} - ${format(parseISO(j.date), 'MMM dd, yyyy')}\n`;
    if (j.verse) md += `**Highlighted Verse:** ${j.verse}\n\n`;
    md += `**Reflection:**\n${j.content}\n\n`;
    md += `---\n\n`;
  });

  return md;
};

export const exportJournalsAsMarkdown = (journals: ProverbJournal[]) => {
  const md = generateJournalsMarkdown(journals);
  if (!md) return;

  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `daily-logos-journals-${format(new Date(), 'yyyy-MM-dd')}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
