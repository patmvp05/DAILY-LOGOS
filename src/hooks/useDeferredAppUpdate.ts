/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import {
  applyPendingUpdate,
  hasPendingUpdate,
  shouldApplyUpdate,
  subscribeToUpdates,
} from '../lib/appUpdate';
import { logDiagnostic } from '../lib/diagnostics';

/**
 * Applies a waiting app update the moment it can't interrupt the user.
 *
 * `isBusy` is driven by the same isAnyOverlayOpen(...) call that drives the
 * body scroll lock in App.tsx — if a surface is important enough to freeze the
 * page behind it, it is important enough not to be reloaded out from under.
 *
 * Three things can make this fire: an update arriving while already idle, the
 * last overlay closing (isBusy flips false and the effect re-runs), and the app
 * being backgrounded — which is also the backstop for a reader left open for
 * hours.
 */
export interface AppBusyState {
  overlayOpen: boolean;
  confirmOpen: boolean;
  isSigningIn: boolean;
}

export function useDeferredAppUpdate({ overlayOpen, confirmOpen, isSigningIn }: AppBusyState): void {
  useEffect(() => {
    const maybeApply = () => {
      const ready = shouldApplyUpdate({
        pending: hasPendingUpdate(),
        overlayOpen,
        confirmOpen,
        isSigningIn,
        documentHidden: document.visibilityState === 'hidden',
      });
      if (!ready) return;
      if (applyPendingUpdate()) {
        logDiagnostic('service-worker', 'info', 'Applying deferred update', {
          hidden: document.visibilityState === 'hidden',
        });
      }
    };

    const unsubscribe = subscribeToUpdates(maybeApply);
    document.addEventListener('visibilitychange', maybeApply);
    // LOAD-BEARING, do not "clean up". onNeedRefresh fires from main.tsx, which
    // runs before React mounts, so the update can already be waiting by the time
    // this hook first subscribes — the event is gone and only this catches it.
    // It is also what applies the update when the last overlay closes, since the
    // effect re-runs on that change.
    maybeApply();

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', maybeApply);
    };
  }, [overlayOpen, confirmOpen, isSigningIn]);
}
