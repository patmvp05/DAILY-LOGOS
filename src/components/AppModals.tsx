/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { memo, Suspense, lazy } from 'react';
import ModalLoader from './ModalLoader';
import { useApp } from '../state/AppContextCore';
import { useUi } from '../state/UiContextCore';
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


import { useProverb } from '../hooks/useProverb';

interface AppModalsProps {
  isSigningIn: boolean;
  handleLogin: (useRedirect?: boolean) => void;
}

export const AppModals = memo(({
   isSigningIn,
   handleLogin
 }: AppModalsProps) => {
   const { state, dispatch } = useApp();
   const {
     showSettings, showHistory, activePlanCategory, selectingCategoryId,
     activeDevotion, showProverbModal,
     syncStatus, lastSyncTime, showSyncCheck
   } = useUi();

   const { user, loading: isAuthLoading, logout } = useAuth();
   const { toggleBookCompletion, jumpToBook, saveProverbJournal, resetProgress, logProverbRead } = useReadingActions(state, dispatch, user);

   const dayOfMonth = new Date().getDate();
   const { proverbContent, isFetchingProverb } = useProverb(dayOfMonth);

   return (
     <Suspense fallback={<ModalLoader />}>
       {showSettings && (
         <SettingsModal
           onLogout={logout}
           handleLogin={handleLogin}
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
    </Suspense>
  );
});
