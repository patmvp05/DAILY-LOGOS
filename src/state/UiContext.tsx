/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import { ToastType } from '../components/Toast';

interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

interface ToastState {
  message: string;
  type: ToastType;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface JournalDraftState {
  id: string | null;
  content: string;
  verse: string;
}

interface UiContextType {
  showSettings: boolean;
  setShowSettings: (val: boolean) => void;
  showHistory: boolean;
  setShowHistory: (val: boolean) => void;
  activePlanCategory: string | null;
  setActivePlanCategory: (id: string | null) => void;
  selectingCategoryId: string | null;
  setSelectingCategoryId: (id: string | null) => void;
  activeDevotion: { name: string, url: string } | null;
  setActiveDevotion: (dev: { name: string, url: string } | null) => void;
  showProverbModal: boolean;
  setShowProverbModal: (val: boolean) => void;
  isStartMenuOpen: boolean;
  setIsStartMenuOpen: (val: boolean) => void;
  confirmDialog: ConfirmDialogState;
  setConfirmDialog: (dialog: ConfirmDialogState) => void;
  closeConfirmDialog: () => void;
  toast: ToastState | null;
  setToast: (toast: ToastState | null) => void;
  showToast: (message: string, type?: ToastType, action?: ToastState['action']) => void;
  journalDraft: JournalDraftState;
  setJournalDraft: (draft: JournalDraftState) => void;
}

const UiContext = createContext<UiContextType | undefined>(undefined);

export function UiContextProvider({ children }: { children: ReactNode }) {
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [activePlanCategory, setActivePlanCategory] = useState<string | null>(null);
  const [selectingCategoryId, setSelectingCategoryId] = useState<string | null>(null);
  const [activeDevotion, setActiveDevotion] = useState<{ name: string, url: string } | null>(null);
  const [showProverbModal, setShowProverbModal] = useState(false);
  const [isStartMenuOpen, setIsStartMenuOpen] = useState(false);
  const [journalDraft, setJournalDraft] = useState<JournalDraftState>({
    id: null,
    content: '',
    verse: ''
  });

  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
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

export function useUi() {
  const context = useContext(UiContext);
  if (context === undefined) {
    throw new Error('useUi must be used within a UiContextProvider');
  }
  return context;
}
