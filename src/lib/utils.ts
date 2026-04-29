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
 * Validates that a URL is a secure http or https link.
 */
export function isValidSecureUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
