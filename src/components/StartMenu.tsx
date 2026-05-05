/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { 
  User as UserIcon, 
  Settings as SettingsIcon, 
  History, 
  Sparkles, 
  Book, 
  LogOut 
} from 'lucide-react';
import { useUi } from '../state/UiContextCore';
import { useAuth } from '../hooks/useAuth';

const StartMenu: React.FC = () => {
  const { 
    isStartMenuOpen: isOpen, 
    setIsStartMenuOpen: setIsOpen,
    setShowSettings,
    setShowHistory,
    setShowProverbModal,
    setJournalDraft
  } = useUi();
  const { user, logout } = useAuth();

  if (!isOpen) return null;

  const onShowSettings = () => { setShowSettings(true); setIsOpen(false); };
  const onShowHistory = () => { setShowHistory(true); setIsOpen(false); };
  const onShowProverbs = () => { 
    setJournalDraft({ id: null, content: '', verse: '' });
    setShowProverbModal(true); 
    setIsOpen(false); 
  };

  return (
    <motion.div 
      initial={{ y: 200, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 200, opacity: 0 }}
      className="xp-start-menu"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="xp-start-menu-header">
        <div className="w-10 h-10 bg-white rounded-md flex items-center justify-center text-[#0974E6] shadow-inner">
          <UserIcon size={24} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold text-white drop-shadow-md">{user?.displayName || user?.email?.split('@')[0] || 'User'}</div>
        </div>
      </div>
      
      <div className="flex h-80 bg-white">
        <div className="flex-1 p-2 border-r border-[#91BEE7]/30">
          <button onClick={onShowSettings} className="xp-menu-item">
            <SettingsIcon size={16} className="text-[#316AC5]" />
            <span>Settings</span>
          </button>
          <button onClick={onShowHistory} className="xp-menu-item">
            <History size={16} className="text-[#316AC5]" />
            <span>Reading Logs</span>
          </button>
          <button onClick={onShowProverbs} className="xp-menu-item">
            <Sparkles size={16} className="text-[#316AC5]" />
            <span>Proverbs Journal</span>
          </button>
        </div>
        <div className="w-40 bg-[#D3E5FA] p-2 flex flex-col">
          <div className="px-2 py-1 text-[9px] font-bold text-[#316AC5] uppercase border-b border-white mb-1">Links</div>
          <button onClick={onShowSettings} className="xp-menu-item">
            <Book size={14} className="text-[#316AC5]" />
            <span>Bible Plan</span>
          </button>
        </div>
      </div>
      
      <div className="bg-[#D3E5FA] p-2 flex justify-end border-t border-white">
        <button 
          onClick={logout}
          className="flex items-center gap-2 px-4 py-1 bg-[#EB8A2F] text-white rounded-sm text-xs font-bold hover:brightness-110 active:brightness-90 shadow-sm border border-[#ce701a]"
        >
          <LogOut size={12} />
          Log Off
        </button>
      </div>
    </motion.div>
  );
};

export default StartMenu;
