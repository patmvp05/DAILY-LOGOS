/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { memo, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  LogIn, 
  RefreshCw, 
  Check, 
  LogOut, 
  Sun, 
  Moon, 
  Monitor, 
  History, 
  RotateCw,
  User as UserIcon,
  Settings 
} from 'lucide-react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { cn } from '../lib/utils';
import { useStandaloneDetection } from '../hooks/useStandaloneDetection';

const WeatherWidget = lazy(() => import('./WeatherWidget'));

interface NavbarProps {
  user: any;
  syncStatus: string;
  lastSyncTime: Date | null;
  showSyncCheck: boolean;
  handleLogin: (redirect?: boolean) => void;
  logout: () => void;
  toggleTheme: () => void;
  theme: 'light' | 'dark' | 'system' | 'xp' | 'audible';
  setShowHistory: (val: boolean) => void;
  setShowSettings: (val: boolean) => void;
  startDate: string;
  isDeveloper: boolean;
  isSigningIn: boolean;
  isAuthLoading: boolean;
}

export const Navbar: React.FC<NavbarProps> = memo(({
  user,
  syncStatus,
  lastSyncTime,
  showSyncCheck,
  handleLogin,
  logout,
  toggleTheme,
  theme,
  setShowHistory,
  setShowSettings,
  startDate,
  isDeveloper,
  isSigningIn,
  isAuthLoading
}) => {
  const isStandalone = useStandaloneDetection();

  return (
    <nav className={cn(
      "fixed top-0 left-0 right-0 h-16 bg-[var(--audible-nav)] border-b border-[var(--audible-border)] z-50 flex items-center justify-between px-4 sm:px-10 transition-colors duration-300",
      isStandalone && "h-[calc(4rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)]"
    )}>
      <div className="flex items-center gap-4 lg:gap-8">
        <div className="flex items-center gap-3">
          <div className="relative group bg-white dark:bg-zinc-800 p-1 rounded-sm">
            {theme === 'xp' ? (
              <svg 
                width="32" height="32" viewBox="0 0 32 32" fill="none" 
                xmlns="http://www.w3.org/2000/svg" 
                className="relative transition-all duration-300"
              >
                <rect x="2" y="2" width="13" height="13" fill="#F44336" rx="1" />
                <rect x="17" y="2" width="13" height="13" fill="#4CAF50" rx="1" />
                <rect x="2" y="17" width="13" height="13" fill="#0054E3" rx="1" />
                <rect x="17" y="17" width="13" height="13" fill="#FFEB3B" rx="1" />
              </svg>
            ) : (
              <img
                src="/icons/logo.png"
                alt="The Daily Logos"
                width={32}
                height={32}
                className="relative w-8 h-8 transition-all duration-300 rounded-sm"
              />
            )}
          </div>
          <span className={cn(
            "text-xl font-black tracking-tighter uppercase hidden sm:block",
            theme === 'xp' && "font-serif normal-case italic text-white drop-shadow-md"
          )}>
            The Daily Logos
          </span>
        </div>
        <Suspense fallback={<div className="w-20 h-8 bg-zinc-100 dark:bg-zinc-800 animate-pulse rounded-full" />}>
          <WeatherWidget />
        </Suspense>
      </div>
      <div className="flex items-center gap-1 sm:gap-6">
        {!user && (
          <motion.button 
            whileTap={{ scale: 0.95 }}
            onClick={() => handleLogin()}
            className="flex items-center gap-2 px-4 h-10 bg-evernote/10 text-evernote rounded-full border border-evernote/20 md:hidden"
          >
            <LogIn size={16} />
            <span className="text-[10px] font-black uppercase tracking-tight">Sync</span>
          </motion.button>
        )}

        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-[#1A1A1A] rounded-full border border-[var(--audible-border)] shadow-sm">
          {user ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <AnimatePresence mode="wait">
                  {syncStatus === 'syncing' ? (
                    <motion.div 
                      key="syncing"
                      initial={{ opacity: 0.6 }}
                      animate={{ opacity: [0.6, 1, 0.6] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="flex items-center gap-2"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-evernote" />
                      <p className="text-[8px] font-black uppercase tracking-widest text-[var(--audible-text-secondary)]">
                        Syncing
                      </p>
                    </motion.div>
                  ) : syncStatus === 'error' ? (
                    <motion.div 
                      key="error"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center gap-2"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      <p className="text-[8px] font-black uppercase tracking-widest text-red-500">
                        Sync Error
                      </p>
                    </motion.div>
                  ) : showSyncCheck ? (
                    <motion.div 
                      key="success"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-2"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-evernote" />
                      <Check className="text-evernote" size={8} strokeWidth={4} />
                      <p className="text-[8px] font-black uppercase tracking-widest text-evernote">
                        Updated
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="synced"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center gap-2"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-evernote opacity-40" />
                      <p className="text-[8px] font-black uppercase tracking-widest text-[var(--audible-text-secondary)]">
                        {lastSyncTime ? `Synced` : 'Online'}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
                <p className="text-[9px] font-bold text-[var(--audible-text-secondary)] max-w-[100px] truncate leading-tight tracking-tight">{user.displayName || user.email}</p>
              </div>
              <motion.button 
                whileTap={{ scale: 0.9 }}
                onClick={logout} 
                className="p-2 rounded-full hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center" 
                title="Log Out"
              >
                <LogOut size={12} />
              </motion.button>
            </div>
          ) : (
            <motion.button 
              whileTap={{ scale: 0.98 }}
              onClick={() => handleLogin()}
              className={cn(
                "text-[10px] font-black uppercase tracking-widest flex items-center gap-2 text-evernote transition-all px-2",
                (isSigningIn || isAuthLoading) ? "opacity-50 cursor-not-allowed" : ""
              )}
              disabled={isSigningIn || isAuthLoading || syncStatus === 'syncing'}
            >
              {isSigningIn ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <LogIn size={14} />
              )}
              {isSigningIn ? 'Connecting...' : 'Sign In to Sync'}
            </motion.button>
          )}
        </div>

        <motion.button 
          whileTap={{ scale: 0.9 }}
          onClick={toggleTheme}
          className={cn(
            "flex flex-col items-end group p-3 min-w-[44px] min-h-[44px]",
            theme === 'xp' && "xp-button px-3 py-1 bg-[#ECE9D8] rounded-sm shadow-sm"
          )}
          title={`Current: ${theme}. Click to cycle.`}
        >
          <p className={cn(
            "text-[10px] uppercase tracking-widest font-bold mb-0.5 transition-colors",
            theme === 'xp' ? "text-blue-700 font-bold" : "text-gray-400 group-hover:text-black dark:group-hover:text-white"
          )}>
            {theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : theme === 'xp' ? 'XP Mode' : 'Auto'}
          </p>
          {theme === 'light' ? (
            <Sun size={20} className="text-gray-300 group-hover:text-black transition-colors" />
          ) : theme === 'dark' ? (
            <Moon size={20} className="text-gray-300 group-hover:text-white transition-colors" />
          ) : theme === 'xp' ? (
            <Monitor size={20} className="text-blue-600" />
          ) : (
            <Monitor size={20} className="text-gray-300 group-hover:text-black dark:group-hover:text-white transition-colors" />
          )}
        </motion.button>

        <motion.button 
          whileTap={{ scale: 0.9 }}
          onClick={() => setShowHistory(true)}
          className={cn(
            "flex flex-col items-end group p-3 min-w-[44px] min-h-[44px]",
            theme === 'xp' && "xp-button px-3 py-1 bg-[#ECE9D8]"
          )}
        >
          <p className={cn(
            "text-[10px] uppercase tracking-widest font-bold mb-0.5 transition-colors",
            theme === 'xp' ? "text-blue-700" : "text-gray-400 group-hover:text-black transition-colors"
          )}>Logs</p>
          <History size={20} className={cn(
            "transition-colors",
            theme === 'xp' ? "text-blue-600" : "text-gray-300 group-hover:text-black"
          )} />
        </motion.button>

        <div className="hidden sm:block text-right pr-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--audible-text-secondary)] font-bold mb-0.5 whitespace-nowrap">Plan Start</p>
          <p className="text-sm font-black uppercase tabular-nums">{startDate ? format(parseISO(startDate), 'MMM dd, yyyy') : 'Loading...'}</p>
        </div>

        <motion.button 
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowSettings(true)}
          className={cn(
            "group relative w-11 h-11 transition-all flex items-center justify-center overflow-hidden shadow-sm aspect-square",
            theme === 'xp' ? "xp-button bg-[#ECE9D8] !p-0" : "rounded-full bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800"
          )}
          title="Account Settings"
        >
          {user?.photoURL ? (
            <img src={user.photoURL} alt="User" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-evernote text-white">
              <UserIcon size={20} />
            </div>
          )}
          <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity" />
        </motion.button>
      </div>
    </nav>
  );
});
