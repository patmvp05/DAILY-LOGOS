/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Mail, Lock, LogIn, UserPlus, RefreshCw, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useUi } from '../state/UiContextCore';

interface EmailAuthFormProps {
  onSuccess?: () => void;
}

export const EmailAuthForm: React.FC<EmailAuthFormProps> = ({ onSuccess }) => {
  const { loginWithEmail, registerWithEmail } = useAuth();
  const { showToast } = useUi();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      showToast("Please fill in all fields.", "error");
      return;
    }
    if (password.length < 6) {
      showToast("Password must be at least 6 characters.", "error");
      return;
    }

    setIsLoading(true);
    try {
      if (isSignUp) {
        await registerWithEmail(email, password);
        showToast("Account created and synced successfully!", "success");
      } else {
        await loginWithEmail(email, password);
        showToast("Logged in and synced successfully!", "success");
      }
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      console.error("Email auth operation failed:", error);
      
      let friendlyMessage = "Authentication failed. Check your credentials.";
      if (error.code === 'auth/email-already-in-use') {
        friendlyMessage = "This email is already registered. Try logging in instead.";
      } else if (error.code === 'auth/invalid-email') {
        friendlyMessage = "Please enter a valid email address.";
      } else if (error.code === 'auth/weak-password') {
        friendlyMessage = "Password is too weak. Choose at least 6 characters.";
      } else if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        friendlyMessage = "Invalid email or password. Please try again.";
      } else if (error.code === 'auth/operation-not-allowed') {
        friendlyMessage = "Email/Password sign-in has not been enabled in your Firebase Console. Please enable it in Firebase Console -> Authentication -> Sign-in method.";
      } else if (error.message) {
        friendlyMessage = error.message;
      }
      
      showToast(friendlyMessage, "error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div id="email-auth-container" className="space-y-4 pt-3 border-t border-[var(--audible-border)]/50">
      <div className="flex items-center gap-2 p-3 bg-blue-500/5 rounded-lg border border-blue-500/10 mb-2 text-[10px] text-[var(--audible-text-secondary)] leading-relaxed font-bold tracking-tight">
        <AlertCircle size={14} className="text-blue-500 shrink-0" />
        <p>
          <strong className="text-blue-500 font-extrabold uppercase tracking-wide">PWA / Standalone Sync Hint:</strong> iOS and iPadOS Home Screen apps block Google OAuth popups/redirects. Use email authentication to sign in and sync seamlessly.
        </p>
      </div>

      <div className="flex bg-zinc-100 dark:bg-zinc-800/50 p-0.5 rounded-lg text-xs font-black uppercase tracking-wider">
        <button
          id="toggle-signin"
          type="button"
          onClick={() => setIsSignUp(false)}
          className={`flex-1 py-1.5 rounded-md transition-all ${!isSignUp ? 'bg-white dark:bg-zinc-700 text-evernote shadow-sm' : 'text-zinc-400 dark:text-zinc-500 hover:text-black dark:hover:text-white'}`}
        >
          Sign In
        </button>
        <button
          id="toggle-signup"
          type="button"
          onClick={() => setIsSignUp(true)}
          className={`flex-1 py-1.5 rounded-md transition-all ${isSignUp ? 'bg-white dark:bg-zinc-700 text-evernote shadow-sm' : 'text-zinc-400 dark:text-zinc-500 hover:text-black dark:hover:text-white'}`}
        >
          Create Account
        </button>
      </div>

      <form id="email-auth-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-[9px] uppercase tracking-wider font-extrabold text-[var(--audible-text-secondary)] block mb-1">Email Address</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-400">
              <Mail size={14} />
            </span>
            <input
              id="email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={isLoading}
              className="w-full pl-9 pr-3 py-2 text-xs border border-[var(--audible-border)] rounded-md focus:border-evernote focus:ring-1 focus:ring-evernote outline-none bg-white dark:bg-[#1A1A1A] text-[var(--audible-text-primary)]"
              required
            />
          </div>
        </div>

        <div>
          <label className="text-[9px] uppercase tracking-wider font-extrabold text-[var(--audible-text-secondary)] block mb-1">Password</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-400">
              <Lock size={14} />
            </span>
            <input
              id="password-input"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignUp ? "At least 6 characters" : "••••••••"}
              disabled={isLoading}
              className="w-full pl-9 pr-10 py-2 text-xs border border-[var(--audible-border)] rounded-md focus:border-evernote focus:ring-1 focus:ring-evernote outline-none bg-white dark:bg-[#1A1A1A] text-[var(--audible-text-primary)]"
              required
            />
            <button
              id="toggle-visibility"
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <button
          id="email-auth-submit"
          type="submit"
          disabled={isLoading}
          className="w-full py-2.5 bg-evernote hover:bg-evernote/90 text-white rounded-md flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-50 font-sans shadow-md cursor-pointer"
        >
          {isLoading ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : isSignUp ? (
            <UserPlus size={14} />
          ) : (
            <LogIn size={14} />
          )}
          {isLoading ? 'Processing...' : isSignUp ? 'Create & Sync Account' : 'Sign In & Sync'}
        </button>
      </form>
    </div>
  );
};
