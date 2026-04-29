/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { X } from 'lucide-react';

interface XpWindowHeaderProps {
  title: string;
  onClose?: () => void;
  icon?: any;
}

export const XpWindowHeader: React.FC<XpWindowHeaderProps> = ({ title, onClose, icon: Icon }) => (
  <div className="xp-window-header flex items-center justify-between px-2 py-1 bg-gradient-to-r from-[#0054E3] via-[#27C1FF] to-[#0054E3] text-white shrink-0">
    <div className="flex items-center gap-2">
      {Icon && <Icon size={14} className="drop-shadow-sm" />}
      <span className="text-xs font-bold font-serif tracking-tight drop-shadow-md">{title}</span>
    </div>
    {onClose && (
      <button 
        onClick={onClose}
        className="w-5 h-5 flex items-center justify-center bg-[#E04343] hover:bg-[#F97D7D] border border-[#7B0303] rounded-sm shadow-sm transition-colors group"
      >
        <X size={12} strokeWidth={3} className="text-white drop-shadow-sm" />
      </button>
    )}
  </div>
);
