/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import {
  Settings as SettingsIcon,
  Check,
  Sun,
  Moon,
  Monitor,
  Calendar,
  RefreshCw,
  Cloud,
  RotateCcw,
  Download,
  Trash2,
  FileText,
  LogOut,
  User as UserIcon,
  LogIn,
  ChevronRight,
  Headphones,
  BookOpen
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '../../lib/utils';
import { XpWindowHeader } from '../XpWindowHeader';
import { setUserSettings } from '../../lib/sync';
import { useApp } from '../../state/AppContext';
import { useUi } from '../../state/UiContext';
import { useAuth } from '../../hooks/useAuth';

interface SettingsModalProps {
  onLogout: () => void;
  handleLogin: (useRedirect?: boolean) => void;
  onExportJournals: () => void;
  onResetProgress: () => void;
  syncStatus: string;
  lastSyncTime: Date | null;
  showSyncCheck: boolean;
  isAuthLoading: boolean;
  isSigningIn: boolean;
}
 
 const SettingsModal: React.FC<SettingsModalProps> = ({
   onLogout,
   handleLogin,
   onExportJournals,
   onResetProgress,
   syncStatus,
   lastSyncTime,
   showSyncCheck,
   isAuthLoading,
   isSigningIn
 }) => {
  const { state, dispatch } = useApp();
  const { setShowSettings, setShowProverbModal, setJournalDraft } = useUi();
  const { user } = useAuth();
  const [settingsTab, setSettingsTab] = React.useState<'general' | 'journals' | 'devotionals'>('general');
  const [newDevotional, setNewDevotional] = React.useState({ name: '', description: '', url: '' });

  const onClose = () => setShowSettings(false);

  return (
    <>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]"
      />
      <motion.div 
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className={cn(
          "fixed right-0 top-0 bottom-0 w-full max-w-md bg-[var(--audible-nav)] z-[210] p-6 sm:p-10 flex flex-col border-l border-[var(--audible-border)] shadow-2xl",
          state.settings.theme === 'xp' && "xp-window border-0 p-0"
        )}
      >
        {state.settings.theme === 'xp' && (
          <XpWindowHeader 
            title="Configuration" 
            onClose={onClose} 
            icon={SettingsIcon} 
          />
        )}
        <div className={cn("flex justify-between items-center mb-8 shrink-0", state.settings.theme === 'xp' && "p-6")}>
          <h3 className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-[var(--audible-text-primary)]">Configuration</h3>
          <button onClick={onClose} className="text-[var(--audible-text-secondary)] hover:text-evernote p-2 transition-colors">
            <Check size={28} strokeWidth={2.5} />
          </button>
        </div>

        <div className={cn("flex p-1 rounded-lg mb-10 shrink-0", state.settings.theme === 'xp' ? "bg-[#ECE9D8] gap-1" : "bg-zinc-100 dark:bg-[#1A1A1A] border border-[var(--audible-border)]")}>
          <button 
            onClick={() => setSettingsTab('general')}
            className={cn(
              "flex-1 py-3 text-[10px] font-black uppercase tracking-[0.12em] rounded-md transition-all",
              state.settings.theme === 'xp' 
                ? (settingsTab === 'general' ? "xp-button bg-white text-blue-700 shadow-inner" : "text-gray-500 hover:text-black")
                : (settingsTab === 'general' ? "bg-white dark:bg-zinc-700 shadow-sm text-evernote" : "text-[var(--audible-text-secondary)] hover:text-zinc-600 dark:hover:text-zinc-300")
            )}
          >
            General
          </button>
          <button 
            onClick={() => setSettingsTab('journals')}
            className={cn(
              "flex-1 py-3 text-[10px] font-black uppercase tracking-[0.12em] rounded-md transition-all",
              state.settings.theme === 'xp' 
                ? (settingsTab === 'journals' ? "xp-button bg-white text-blue-700 shadow-inner" : "text-gray-500 hover:text-black")
                : (settingsTab === 'journals' ? "bg-white dark:bg-zinc-700 shadow-sm text-evernote" : "text-[var(--audible-text-secondary)] hover:text-zinc-600 dark:hover:text-zinc-300")
            )}
          >
            Journals ({state.proverbJournals.length})
          </button>
          <button 
            onClick={() => setSettingsTab('devotionals')}
            className={cn(
              "flex-1 py-3 text-[10px] font-black uppercase tracking-[0.12em] rounded-md transition-all",
              state.settings.theme === 'xp' 
                ? (settingsTab === 'devotionals' ? "xp-button bg-white text-blue-700 shadow-inner" : "text-gray-500 hover:text-black")
                : (settingsTab === 'devotionals' ? "bg-white dark:bg-zinc-700 shadow-sm text-evernote" : "text-[var(--audible-text-secondary)] hover:text-zinc-600 dark:hover:text-zinc-300")
            )}
          >
            Devotions
          </button>
        </div>

        {/* Mobile Cloud Access */}
        <div className="md:hidden mb-10">
          <h4 className="text-[10px] uppercase font-black tracking-[0.12em] text-[var(--audible-text-secondary)] mb-3">Sync Status</h4>
          {user ? (
            <div className="p-4 bg-[var(--audible-card)] rounded-xl flex items-center justify-between border border-[var(--audible-border)] shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-evernote/10 flex items-center justify-center text-evernote">
                  <UserIcon size={20} />
                </div>
                <div>
                  <p className="text-xs font-black uppercase text-[var(--audible-text-primary)]">{user.displayName || 'Authenticated User'}</p>
                  <p className="text-[10px] text-[var(--audible-text-secondary)] font-bold tracking-tight">{user.email}</p>
                </div>
              </div>
              <button onClick={onLogout} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-full transition-colors">
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <button 
                onClick={() => !isAuthLoading && !isSigningIn && handleLogin(false)}
                disabled={syncStatus === 'syncing' || isAuthLoading || isSigningIn}
                className="w-full p-4 bg-evernote text-white rounded-xl flex items-center justify-center gap-3 font-black uppercase tracking-[0.2em] text-[10px] shadow-lg shadow-evernote/20 disabled:opacity-50"
              >
                {(isSigningIn || isAuthLoading) ? <RefreshCw size={16} className="animate-spin" /> : <LogIn size={16} />}
                {(isSigningIn || isAuthLoading) ? 'Connecting...' : 'Sign In with Google'}
              </button>
              <button 
                onClick={() => !isAuthLoading && !isSigningIn && handleLogin(true)}
                className="w-full p-2 text-[var(--audible-text-secondary)] font-bold uppercase text-[8px] tracking-[0.12em] hover:text-evernote transition-colors"
                disabled={isAuthLoading || isSigningIn}
              >
                Safari User? Try Alternative Mode
              </button>
            </div>
          )}
        </div>

        <div className={cn("flex-1 overflow-y-auto space-y-10 pr-2", state.settings.theme === 'xp' && "p-6")}>
          {settingsTab === 'general' ? (
            <>
              <div>
                <label className="text-[10px] uppercase font-black tracking-[0.12em] text-[var(--audible-text-secondary)] block mb-3">App Theme</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { id: 'light', name: 'Light', Icon: Sun },
                    { id: 'dark', name: 'Dark', Icon: Moon },
                    { id: 'system', name: 'System', Icon: Monitor },
                    { id: 'audible', name: 'Audible', Icon: Headphones },
                    { id: 'xp', name: 'XP', Icon: Monitor },
                    { id: 'textbook', name: 'Textbook', Icon: BookOpen },
                  ].map(({ id, name, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        dispatch({ type: 'SET_THEME', theme: id as any });
                        if (user) {
                          setUserSettings(user.uid, { theme: id as any, startDate: state.settings.startDate });
                        }
                      }}
                      className={cn(
                        "flex flex-col items-center gap-2 p-4 border rounded-xl transition-all",
                        state.settings.theme === id
                          ? "border-evernote bg-evernote/[0.03] text-evernote shadow-sm"
                          : "border-[var(--audible-border)] text-zinc-400 dark:text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-700",
                        id === 'xp' && state.settings.theme === 'xp' ? "border-[#0054E3] bg-[#ECE9D8] text-[#0054E3]" : "",
                        id === 'textbook' && state.settings.theme === 'textbook' ? "border-[#8B5E3C] bg-[#FAF5E4] text-[#8B5E3C]" : ""
                      )}
                    >
                      <Icon size={18} />
                      <span className="text-[10px] font-black uppercase tracking-[0.12em]">{name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-black tracking-[0.12em] text-[var(--audible-text-secondary)] block mb-3">Plan Start Date</label>
                <div className="flex items-center gap-4 p-5 border border-[var(--audible-border)] rounded-xl bg-white dark:bg-[#1A1A1A] text-[var(--audible-text-primary)]">
                  <Calendar size={20} className="text-zinc-400 dark:text-zinc-600" />
                  <input 
                    type="date"
                    value={format(parseISO(state.settings.startDate), 'yyyy-MM-dd')}
                    onChange={(e) => {
                      const newDate = new Date(e.target.value).toISOString();
                      dispatch({ type: 'SET_START_DATE', date: newDate });
                    }}
                    className="bg-transparent border-none outline-none font-bold flex-1 text-sm appearance-none"
                  />
                </div>
              </div>

              <div className="pt-10 border-t border-[var(--audible-border)] text-center py-10 opacity-30">
                <SettingsIcon size={48} className="mx-auto mb-4 text-zinc-400" />
                <p className="text-[10px] uppercase font-black tracking-[0.12em]">More options coming soon</p>
              </div>

              <div className="pt-10 border-t border-[var(--audible-border)]">
                <h4 className="text-[10px] uppercase font-black tracking-[0.12em] text-[var(--audible-text-secondary)] mb-4">Management</h4>
                
                <div className="space-y-3">
                  <button 
                    onClick={() => window.location.reload()}
                    className="w-full p-5 flex items-center justify-between border border-[var(--audible-border)] text-[var(--audible-text-primary)] hover:bg-zinc-50 dark:hover:bg-white/5 rounded-xl transition-colors font-black uppercase text-[10px] tracking-[0.12em]"
                  >
                    <span>Force App Refresh</span>
                    <RefreshCw size={18} />
                  </button>

                  <button 
                    onClick={onResetProgress}
                    className="w-full p-5 flex items-center justify-between border border-red-100 dark:border-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-xl transition-colors font-black uppercase text-[10px] tracking-[0.12em]"
                  >
                    <span>Wipe All Data</span>
                    <RotateCcw size={18} />
                  </button>
                </div>
              </div>
            </>
          ) : settingsTab === 'journals' ? (
            <div className="space-y-6 pb-12">
              <button 
                onClick={onExportJournals}
                className="w-full p-6 bg-evernote text-white rounded-xl mb-8 flex items-center justify-between shadow-xl shadow-evernote/20 hover:translate-y-[-2px] transition-all"
              >
                <div className="text-left">
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] opacity-80">Archive Export</p>
                  <h4 className="text-lg font-black uppercase tracking-tight">Download Markdown</h4>
                </div>
                <Download size={24} />
              </button>

              {state.proverbJournals.length > 0 ? (
                [...state.proverbJournals].sort((a,b) => b.date.localeCompare(a.date)).map((entry) => (
                  <div key={entry.id} className="p-6 bg-[var(--audible-card)] border border-[var(--audible-border)] rounded-2xl group shadow-sm">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-evernote">Proverbs {entry.chapter}</p>
                        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--audible-text-secondary)]">{format(parseISO(entry.date), 'MMM dd, yyyy')}</p>
                      </div>
                      <button 
                        onClick={() => dispatch({ type: 'DELETE_JOURNAL', id: entry.id })}
                        className="p-2 opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-600"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    {entry.verse && (
                      <div className="mb-4 pl-3 border-l-2 border-evernote/30 italic text-sm text-[var(--audible-text-secondary)] font-serif">
                        "{entry.verse}"
                      </div>
                    )}
                    <p className="text-sm font-medium leading-relaxed text-[var(--audible-text-primary)] line-clamp-3">
                      {entry.content}
                    </p>
                    <button 
                      onClick={() => {
                        onClose();
                        setShowProverbModal(true);
                      }}
                      className="mt-4 text-[10px] font-black uppercase tracking-[0.12em] text-evernote hover:underline"
                    >
                      View / Edit
                    </button>
                  </div>
                ))
              ) : (
                <div className="py-20 text-center opacity-20 capitalize">
                  <FileText size={64} className="mx-auto mb-4" />
                  <p className="font-black uppercase tracking-[0.12em]">No entries yet.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-10 pb-12">
              <div className="p-6 bg-[var(--audible-card)] border border-[var(--audible-border)] rounded-2xl shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-evernote mb-4">Add New Devotional</p>
                <div className="space-y-4">
                  <input 
                    type="text" 
                    placeholder="Name (e.g. My Favorite Daily)"
                    className="w-full p-4 bg-white dark:bg-[#1A1A1A] border border-[var(--audible-border)] rounded-xl outline-none text-sm font-bold text-[var(--audible-text-primary)] focus:border-evernote transition-all"
                    value={newDevotional.name}
                    onChange={(e) => setNewDevotional({...newDevotional, name: e.target.value})}
                  />
                  <input 
                    type="text" 
                    placeholder="Author/Description"
                    className="w-full p-4 bg-white dark:bg-[#1A1A1A] border border-[var(--audible-border)] rounded-xl outline-none text-sm font-bold text-[var(--audible-text-primary)] focus:border-evernote transition-all"
                    value={newDevotional.description}
                    onChange={(e) => setNewDevotional({...newDevotional, description: e.target.value})}
                  />
                  <div className="space-y-1">
                    <input 
                      type="text" 
                      placeholder="URL (Use {{date}} for dynamic dates)"
                      className="w-full p-4 bg-white dark:bg-[#1A1A1A] border border-[var(--audible-border)] rounded-xl outline-none text-sm font-bold text-[var(--audible-text-primary)] focus:border-evernote transition-all"
                      value={newDevotional.url}
                      onChange={(e) => setNewDevotional({...newDevotional, url: e.target.value})}
                    />
                    <p className="text-[9px] text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-[0.12em] px-2 italic">Example: https://site.com/{'{{date}}'}</p>
                  </div>
                    <button 
                      onClick={() => {
                        if (newDevotional.name && newDevotional.url) {
                          dispatch({ 
                            type: 'ADD_DEVOTIONAL', 
                            devotional: { 
                              ...newDevotional, 
                              id: (typeof crypto !== 'undefined' && crypto.randomUUID) 
                                ? crypto.randomUUID() 
                                : Math.random().toString(36).substring(2, 11) 
                            } 
                          });
                          setNewDevotional({ name: '', description: '', url: '' });
                        }
                      }}
                      className={cn(
                        "w-full py-5 text-[10px] font-black uppercase tracking-[0.2em] transition-all",
                        state.settings.theme === 'xp' ? "xp-button bg-[#ECE9D8] text-black" : "bg-black dark:bg-white text-white dark:text-black rounded-xl shadow-lg shadow-black/5 hover:translate-y-[-1px] active:scale-95"
                      )}
                    >
                      Add to Collection
                    </button>
                </div>
              </div>

              <div className="space-y-4">
                {state.customDevotionals.map((dev) => (
                  <div key={dev.id} className="p-5 border border-[var(--audible-border)] rounded-2xl flex justify-between items-center group bg-white dark:bg-[#1A1A1A]/30">
                    <div>
                      <h4 className="text-sm font-black uppercase truncate max-w-[200px] text-[var(--audible-text-primary)]">{dev.name}</h4>
                      <p className="text-[10px] text-[var(--audible-text-secondary)] font-bold uppercase tracking-[0.12em]">{dev.description}</p>
                    </div>
                    <button 
                      onClick={() => dispatch({ type: 'DELETE_DEVOTIONAL', id: dev.id })}
                      className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-full"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <button 
          onClick={onClose}
          className={cn(
            "w-full p-6 font-black uppercase tracking-[0.2em] text-[10px] transition-all",
            state.settings.theme === 'xp' ? "xp-button bg-[#ECE9D8] text-black" : "bg-black dark:bg-white text-white dark:text-black rounded-xl hover:translate-y-[-2px] active:scale-95 shadow-xl shadow-black/10 active:shadow-none"
          )}
        >
          Close Panel
        </button>
      </motion.div>
    </>
  );
};

export default SettingsModal;
