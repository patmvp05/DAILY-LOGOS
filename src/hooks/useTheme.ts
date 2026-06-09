/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';

export function useTheme(theme: 'light' | 'dark' | 'system' | 'xp' | 'audible' | 'textbook') {
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark', 'theme-xp', 'audible', 'theme-textbook');
    root.style.backgroundImage = "";

    // Map the old eclectic themes to the new Coinbase-style minimal theme
    const resolvedTheme = ['xp', 'audible', 'textbook', 'system'].includes(theme) 
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;

    root.classList.add(resolvedTheme);
  }, [theme]);
}
