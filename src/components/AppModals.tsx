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
const DevotionalReaderModal = lazy(() => import('./modals/DevotionalReaderModal'));
const ReaderModal = lazy(() => import('./modals/ReaderModal'));
const ScriptureSprintModal = lazy(() => import('./modals/ScriptureSprintModal'));


import { useProverb } from '../hooks/useProverb';
import { useDevotional } from '../hooks/useDevotional';
import { useToday } from '../hooks/useToday';
import { getDevotionalAuthor } from '../lib/devotionalCatalog';

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
     readerCategoryId, activeDevotion, activeInternalDevotional, setActiveInternalDevotional,
     showProverbModal, showSprintModal,
     syncStatus, lastSyncTime, showSyncCheck
   } = useUi();

   const { user, loading: isAuthLoading, logout } = useAuth();
   const { toggleBookCompletion, jumpToBook, saveProverbJournal, resetProgress, logProverbRead, logDevotionalRead, advanceChapter, toggleSprintHour, setSprintReference, clearSprint } = useReadingActions(state, dispatch, user);

   // useToday keeps this fresh across midnight so the proverb modal opens on
   // the right chapter without a reload.
   const todayStr = useToday();
   const dayOfMonth = Number(todayStr.slice(8, 10));
   const { proverbContent, isFetchingProverb } = useProverb(dayOfMonth, state.settings.bibleVersion);
   const { devotionalContent, isFetchingDevotional, error: devotionalError } = useDevotional(activeInternalDevotional?.slug ?? null);

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

      {showSprintModal && (
        <ScriptureSprintModal
          todayStr={todayStr}
          toggleSprintHour={toggleSprintHour}
          setSprintReference={setSprintReference}
          clearSprint={clearSprint}
        />
      )}

      {activePlanCategory && <CategoryPlanModal toggleBookCompletion={toggleBookCompletion} />}
      {selectingCategoryId && <BookSelectorModal jumpToBook={jumpToBook} toggleBookCompletion={toggleBookCompletion} />}
      {readerCategoryId && <ReaderModal advanceChapter={advanceChapter} />}
      {activeDevotion && <DevotionalModal />}
      {activeInternalDevotional && (
        <DevotionalReaderModal
          name={activeInternalDevotional.name}
          author={getDevotionalAuthor(activeInternalDevotional.id)}
          isFetching={isFetchingDevotional}
          content={devotionalContent}
          error={devotionalError}
          onClose={() => setActiveInternalDevotional(null)}
          onRead={() => logDevotionalRead(activeInternalDevotional.slug, activeInternalDevotional.name)}
        />
      )}
    </Suspense>
  );
});
