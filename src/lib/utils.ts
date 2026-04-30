/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combines Tailwind classes with clsx and twMerge.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Validates that a URL starts with http:// or https:// (case-insensitive) for security purposes.
 */
export function isValidSecureUrl(url: string): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url.trim());
}
