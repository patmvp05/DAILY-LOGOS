/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext } from 'react';
import { ToastType } from '../components/Toast';

export interface ToastState {
  message: string;
  type: ToastType;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface JournalDraftState {
  id: string | null;
  content: string;
  verse: string;
}

export interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

export interface UiContextType {
  showSettings: boolean;
  setShowSettings: (val: boolean) => void;
  showHistory: boolean;
  setShowHistory: (val: boolean) => void;
  activePlanCategory: string | null;
  setActivePlanCategory: (catId: string | null) => void;
  selectingCategoryId: string | null;
  setSelectingCategoryId: (catId: string | null) => void;
  activeDevotion: { name: string, url: string } | null;
  setActiveDevotion: (dev: { name: string, url: string } | null) => void;
  showProverbModal: boolean;
  setShowProverbModal: (val: boolean) => void;
  isStartMenuOpen: boolean;
  setIsStartMenuOpen: (val: boolean) => void;
  journalDraft: JournalDraftState;
  setJournalDraft: (val: JournalDraftState) => void;
  toast: ToastState | null;
  setToast: (val: ToastState | null) => void;
  showToast: (message: string, type?: ToastType, action?: ToastState['action']) => void;
  confirmDialog: ConfirmDialogState;
  setConfirmDialog: (val: ConfirmDialogState) => void;
  closeConfirmDialog: () => void;

  // Sync State
  syncStatus: string;
  setSyncStatus: (val: string) => void;
  lastSyncTime: Date | null;
  setLastSyncTime: (val: Date | null) => void;
  showSyncCheck: boolean;
  setShowSyncCheck: (val: boolean) => void;
}

export const UiContext = createContext<UiContextType | undefined>(undefined);

export function useUi() {
  const context = useContext(UiContext);
  if (context === undefined) {
    throw new Error('useUi must be used within a UiContextProvider');
  }
  return context;
}
