/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense, lazy } from 'react';
import ModalLoader from './ModalLoader';
import { useApp } from '../state/AppContext';
import { useUi } from '../state/UiContext';
import { useAuth } from '../hooks/useAuth';
import { useReadingActions } from '../hooks/useReadingActions';
import { exportJournalsAsMarkdown } from '../lib/export';

// Lazy Modals
const SettingsModal = lazy(() => import('./modals/SettingsModal'));
const HistoryModal = lazy(() => import('./modals/HistoryModal'));
const ProverbModal = lazy(() => import('./modals/ProverbModal'));
const CategoryPlanModal = lazy(() => import('./modals/CategoryPlanModal'));
const BookSelectorModal = lazy(() => import('./modals/BookSelectorModal'));
const DevotionalModal = lazy(() => import('./modals/DevotionalModal'));
const StartMenu = lazy(() => import('./StartMenu'));

interface AppModalsProps {
  syncStatus: string;
  lastSyncTime: Date | null;
  showSyncCheck: boolean;
  isSigningIn: boolean;
  proverbContent: any;
  isFetchingProverb: boolean;
  dayOfMonth: number;
}
 
export function AppModals({
   syncStatus,
   lastSyncTime,
   showSyncCheck,
   isSigningIn,
   proverbContent,
   isFetchingProverb,
   dayOfMonth
 }: AppModalsProps) {
   const { state, dispatch } = useApp();
   const { 
     showSettings, setShowSettings,
     showHistory, setShowHistory,
     activePlanCategory, setActivePlanCategory,
     selectingCategoryId, setSelectingCategoryId,
     activeDevotion, setActiveDevotion,
     showProverbModal, setShowProverbModal,
     isStartMenuOpen, setIsStartMenuOpen,
   } = useUi();
 
   const { user, loading: isAuthLoading, logout, login } = useAuth();
   const { toggleBookCompletion, jumpToBook, saveProverbJournal, resetProgress, logProverbRead } = useReadingActions(state, dispatch, user);
 
   return (
     <Suspense fallback={<ModalLoader />}>
       {showSettings && (
         <SettingsModal 
           onLogout={logout}
           handleLogin={login}
           onExportJournals={() => exportJournalsAsMarkdown(state.proverbJournals)}
           onResetProgress={resetProgress}
           syncStatus={syncStatus}
           lastSyncTime={lastSyncTime}
           showSyncCheck={showSyncCheck}
           isAuthLoading={isAuthLoading}
           isSigningIn={isSigningIn}
         />
       )}

      {showHistory && <HistoryModal />}
      {showProverbModal && (
        <ProverbModal 
          dayOfMonth={dayOfMonth}
          isFetchingProverb={isFetchingProverb}
          proverbContent={proverbContent}
          saveProverbJournal={saveProverbJournal}
          logProverbRead={logProverbRead}
        />
      )}

      {activePlanCategory && <CategoryPlanModal toggleBookCompletion={toggleBookCompletion} />}
      {selectingCategoryId && <BookSelectorModal jumpToBook={jumpToBook} toggleBookCompletion={toggleBookCompletion} />}
      {activeDevotion && <DevotionalModal />}
      {state.settings.theme === 'xp' && (
        <StartMenu />
      )}
    </Suspense>
  );
}
