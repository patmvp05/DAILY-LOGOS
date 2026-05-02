/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';

export function useTheme(theme: 'light' | 'dark' | 'system' | 'xp' | 'audible' | 'textbook') {
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark', 'theme-xp', 'audible', 'theme-textbook');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else if (theme === 'audible') {
      // For audible, we check system theme to see if we should apply dark mode
      const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add('audible');
      root.classList.add(isSystemDark ? 'dark' : 'light');
    } else if (theme === 'textbook') {
      root.classList.add('theme-textbook');
      root.classList.add('light'); // Textbook theme is light-based
    } else if (theme === 'xp') {
      root.classList.add('theme-xp');
      // Apply background dynamically to avoid loading it for non-XP users
      root.style.backgroundImage = "url('https://images.unsplash.com/photo-1500382017468-9049fed747ef?q=80&w=1080&auto=format&fit=crop')";
      root.style.backgroundAttachment = "fixed";
      root.style.backgroundSize = "cover";
      root.style.backgroundPosition = "center";
      root.style.backgroundRepeat = "no-repeat";
    } else {
      root.classList.add(theme);
      // Reset background for other themes
      root.style.backgroundImage = "";
      root.style.backgroundAttachment = "";
      root.style.backgroundSize = "";
      root.style.backgroundPosition = "";
      root.style.backgroundRepeat = "";
    }
  }, [theme]);
}
