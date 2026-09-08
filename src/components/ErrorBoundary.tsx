/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { RefreshCw } from 'lucide-react';
import { logDiagnostic } from '../lib/diagnostics';
import { attemptChunkReload, isStaleChunkError, clearAutoReloaded } from '../lib/chunkRecovery';

interface Props {
  children: React.ReactNode;
  /** Which part of the app this wraps, for the diagnostic log. */
  label: string;
  /**
   * Render the fallback as a bottom banner rather than a page block. For a
   * subtree that normally draws nothing (the modals), a half-screen error panel
   * under the dashboard would be stranger than the failure — but saying nothing
   * at all leaves cards that silently do nothing when tapped.
   */
  banner?: boolean;
}

interface State {
  error: Error | null;
}

/**
 * Stops one broken subtree from blanking the whole app.
 *
 * React unmounts everything on an uncaught render error, and there was no
 * boundary anywhere — so any throw, including a lazy import that failed because
 * its chunk was deleted by a deploy, left a white screen with no way back.
 *
 * Must be a class: getDerivedStateFromError/componentDidCatch have no hook
 * equivalent. Wrapped around each lazy boundary separately so a failure in the
 * modals cannot take the dashboard down with it.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logDiagnostic('render', 'error', `${this.props.label} failed to render`, {
      message: error.message,
      stale: isStaleChunkError(error),
      componentStack: info.componentStack?.slice(0, 600),
    });
    // A stale chunk is fixed by reloading, so do it rather than making the user
    // read about it. Returns false once this session has already spent its one
    // attempt, and then the fallback below is what they get.
    if (isStaleChunkError(error)) attemptChunkReload();
  }

  private retry = () => {
    clearAutoReloaded();
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = isStaleChunkError(error);
    const heading = stale ? 'A new version is ready' : 'Something went wrong';
    const detail = stale
      ? 'This tab is running an older build and could not load the rest of it. Reloading picks up the current version.'
      : 'That part of the app stopped unexpectedly. Your reading progress is saved.';
    const reload = (
      <button
        onClick={this.retry}
        className="min-h-[48px] px-6 shrink-0 font-bold uppercase tracking-widest text-[11px] flex items-center justify-center gap-2 rounded-[18px] bg-[var(--text-primary)] text-[var(--bg-primary)] shadow-sm hover:opacity-90 active:scale-[0.98] transition-all"
      >
        <RefreshCw size={15} />
        Reload
      </button>
    );

    if (this.props.banner) {
      return (
        <div
          className="fixed bottom-0 inset-x-0 z-[900] px-5 py-4 flex items-center gap-4 bg-[var(--bg-primary)] border-t border-[var(--border-color)] shadow-2xl"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-primary)]">{heading}</p>
            <p className="text-xs text-[var(--text-secondary)] leading-snug">{detail}</p>
          </div>
          {reload}
        </div>
      );
    }

    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-8 gap-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">{heading}</p>
        <p className="text-sm text-[var(--text-secondary)] max-w-sm leading-relaxed">{detail}</p>
        {reload}
      </div>
    );
  }
}

export default ErrorBoundary;
