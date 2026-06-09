/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { memo, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LogIn, 
  RefreshCw, 
  Check, 
  LogOut, 
  Sun, 
  Moon, 
  Monitor, 
  History, 
  FileText,
  User as UserIcon 
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '../lib/utils';
import { useStandaloneDetection } from '../hooks/useStandaloneDetection';
import { type User } from 'firebase/auth';

const WeatherWidget = lazy(() => import('./WeatherWidget'));

interface NavbarProps {
  user: User | null;
  syncStatus: string;
  lastSyncTime: Date | null;
  showSyncCheck: boolean;
  handleLogin: (redirect?: boolean) => void;
  logout: () => void;
  toggleTheme: () => void;
  theme: 'light' | 'dark' | 'system' | 'xp' | 'audible' | 'textbook';
  setShowHistory: (val: boolean) => void;
  setShowSettings: (val: boolean) => void;
  startDate: string;
  isSigningIn: boolean;
  isAuthLoading: boolean;
}

const NavbarComponent = memo(({
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
  isSigningIn,
  isAuthLoading
}: NavbarProps) => {
  const isStandalone = useStandaloneDetection();
  const [imgError, setImgError] = React.useState(false);

  React.useEffect(() => {
    setImgError(false);
  }, [user?.photoURL, user?.uid]);

  const userInitial = React.useMemo(() => {
    if (!user) return '';
    const name = user.displayName || user.email || '';
    const clean = name.trim().replace(/^mailto:/i, '');
    return clean ? clean[0].toUpperCase() : '';
  }, [user]);

  return (
    <nav className={cn(
      "fixed top-0 left-0 right-0 h-16 bg-[var(--nav-bg)] backdrop-blur-md border-b border-[var(--border-color)] z-50 flex items-center justify-between px-4 sm:px-10 transition-colors duration-300",
      isStandalone && "h-[calc(4rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)]"
    )}>
      <div className="flex items-center gap-4 lg:gap-8">
        <div className="flex items-center gap-3">
          <div className="relative group">
            <img
              src="/icons/logo.svg"
              alt="The Daily Logos"
              width={32}
              height={32}
              className="relative w-8 h-8 transition-transform duration-300 group-hover:scale-105 active:scale-95"
            />
          </div>
          <span className="text-xl font-bold tracking-tighter hidden sm:block">
            The Daily Logos
          </span>
        </div>
        <Suspense fallback={<div className="w-20 h-8 bg-[var(--bg-secondary)] animate-pulse rounded-full" />}>
          <WeatherWidget />
        </Suspense>
      </div>
      <div className="flex items-center gap-1 sm:gap-6">
        {!user && (
          <motion.button 
            whileTap={{ scale: 0.95 }}
            onClick={() => handleLogin()}
            className="flex items-center gap-2 px-4 h-10 bg-brand/10 text-brand rounded-full border border-brand/20 md:hidden"
          >
            <LogIn size={16} />
            <span className="text-[11px] font-bold tracking-wide">Sync</span>
          </motion.button>
        )}

        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-secondary)] rounded-full border border-[var(--border-color)] shadow-sm">
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
                      <div className="w-1.5 h-1.5 rounded-full bg-brand" />
                      <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">
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
                      <div className="w-1.5 h-1.5 rounded-full bg-brand" />
                      <Check className="text-brand" size={10} strokeWidth={4} />
                      <p className="text-[9px] font-bold uppercase tracking-widest text-brand">
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
                      <div className="w-1.5 h-1.5 rounded-full bg-brand opacity-40" />
                      <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">
                        {lastSyncTime ? `Synced` : 'Online'}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
                <p className="text-[10px] font-bold text-[var(--text-secondary)] max-w-[100px] truncate leading-tight tracking-tight mt-0.5">{user.displayName || user.email}</p>
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
                "text-[11px] font-bold tracking-wide flex items-center gap-2 text-brand transition-all px-2",
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
          className="flex flex-col items-end group p-3 min-w-[44px] min-h-[44px]"
          title={`Current: ${theme}. Click to cycle.`}
        >
          <p className="text-[10px] uppercase tracking-widest font-bold mb-0.5 transition-colors text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
            {theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'Auto'}
          </p>
          {theme === 'light' ? (
            <Sun size={20} className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors" />
          ) : theme === 'dark' ? (
            <Moon size={20} className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors" />
          ) : (
            <Monitor size={20} className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors" />
          )}
        </motion.button>

        <motion.button 
          whileTap={{ scale: 0.9 }}
          onClick={() => setShowHistory(true)}
          className="flex flex-col items-end group p-3 min-w-[44px] min-h-[44px]"
        >
          <p className="text-[10px] uppercase tracking-widest font-bold mb-0.5 transition-colors text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">Logs</p>
          <History size={20} className="transition-colors text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]" />
        </motion.button>

        <div className="hidden sm:block text-right pr-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-0.5 whitespace-nowrap">Plan Start</p>
          <p className="text-sm font-bold uppercase tabular-nums">{startDate ? format(parseISO(startDate), 'MMM dd, yyyy') : (user ? 'Select start date' : 'Log in to sync')}</p>
        </div>

        <motion.button 
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowSettings(true)}
          className="group relative w-11 h-11 transition-all flex items-center justify-center overflow-hidden shadow-sm aspect-square rounded-full bg-[var(--bg-secondary)] border border-[var(--border-color)]"
          title="Account Settings"
        >
          {user && user.photoURL && !imgError ? (
            <img 
              src={user.photoURL} 
              alt="User" 
              className="w-full h-full object-cover" 
              referrerPolicy="no-referrer" 
              onError={() => setImgError(true)}
            />
          ) : user && userInitial ? (
            <div className="w-full h-full flex items-center justify-center bg-brand text-white font-bold text-sm uppercase tracking-tight select-none">
              {userInitial}
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
              <UserIcon size={20} />
            </div>
          )}
          <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity" />
        </motion.button>
      </div>
    </nav>
  );
});

export const Navbar = NavbarComponent;
