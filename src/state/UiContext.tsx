/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import type { ReactNode } from 'react';
import { ToastType } from '../components/Toast';
import { 
  UiContext, 
  JournalDraftState, 
  ToastState, 
  ConfirmDialogState 
} from './UiContextCore';

export function UiContextProvider({ children }: { children: ReactNode }) {
  console.log("[UiContextProvider] Rendering...");
  const [showSettings, setShowSettings] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);
  const [activePlanCategory, setActivePlanCategory] = React.useState<string | null>(null);
  const [selectingCategoryId, setSelectingCategoryId] = React.useState<string | null>(null);
  const [activeDevotion, setActiveDevotion] = React.useState<{ name: string, url: string } | null>(null);
  const [showProverbModal, setShowProverbModal] = React.useState(false);
  const [isStartMenuOpen, setIsStartMenuOpen] = React.useState(false);
  const [journalDraft, setJournalDraft] = React.useState<JournalDraftState>({
    id: null,
    content: '',
    verse: ''
  });

  const [toast, setToast] = React.useState<ToastState | null>(null);
  const [confirmDialog, setConfirmDialog] = React.useState<ConfirmDialogState>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const closeConfirmDialog = () => setConfirmDialog(prev => ({ ...prev, isOpen: false }));

  const showToast = (message: string, type: ToastType = 'success', action?: ToastState['action']) => {
    setToast({ message, type, action });
  };

  const value = useMemo(() => ({
    showSettings, setShowSettings,
    showHistory, setShowHistory,
    activePlanCategory, setActivePlanCategory,
    selectingCategoryId, setSelectingCategoryId,
    activeDevotion, setActiveDevotion,
    showProverbModal, setShowProverbModal,
    isStartMenuOpen, setIsStartMenuOpen,
    confirmDialog, setConfirmDialog, closeConfirmDialog,
    toast, setToast, showToast,
    journalDraft, setJournalDraft
  }), [
    showSettings, showHistory, activePlanCategory, selectingCategoryId,
    activeDevotion, showProverbModal, isStartMenuOpen, confirmDialog,
    toast, journalDraft
  ]);

  return (
    <UiContext.Provider value={value}>
      {children}
    </UiContext.Provider>
  );
}
