import React, { useState, useEffect, useCallback } from 'react';
import { Lock, Delete, X, ShieldAlert, KeyRound, CheckCircle2, Loader2 } from 'lucide-react';
import { VaultCryptoService } from '../services/vault-crypto.js';
import { api } from '../services/api.js';
import { User } from '../types.js';

interface VaultPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onUnlocked: (vaultKey: CryptoKey) => void;
  onUserUpdated?: (user: User) => void;
}

export const VaultPinModal: React.FC<VaultPinModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUnlocked,
  onUserUpdated,
}) => {
  const isSetupMode = !currentUser.hasEncryptedVault || !currentUser.encryptedVaultKey || !currentUser.masterKeySalt;

  const [pin, setPin] = useState('');
  const [setupStep, setSetupStep] = useState<1 | 2>(1); // 1 = choose PIN, 2 = confirm PIN
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Reset state when opening/closing
  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError('');
      setSetupStep(1);
      setFirstPin('');
      setIsProcessing(false);
    }
  }, [isOpen]);

  const triggerError = useCallback((msg: string) => {
    setError(msg);
    setShake(true);
    setPin('');
    setTimeout(() => setShake(false), 500);
  }, []);

  const handleCompletePin = useCallback(
    async (enteredPin: string) => {
      if (enteredPin.length !== 4) return;
      setIsProcessing(true);
      setError('');

      try {
        if (isSetupMode) {
          if (setupStep === 1) {
            // First step of setup complete, ask for confirmation
            setFirstPin(enteredPin);
            setPin('');
            setSetupStep(2);
            setIsProcessing(false);
            return;
          } else {
            // Confirming PIN
            if (enteredPin !== firstPin) {
              setFirstPin('');
              setSetupStep(1);
              triggerError('PINs do not match. Please choose your 4-digit PIN again.');
              setIsProcessing(false);
              return;
            }

            // Derive key and set up vault
            const { saltHex, encryptedVaultKey, key } = await VaultCryptoService.setupVaultWithPin(enteredPin);
            await api.updateVaultCredentials(saltHex, encryptedVaultKey);
            await VaultCryptoService.exportKeyToSession(key);

            if (onUserUpdated) {
              onUserUpdated({
                ...currentUser,
                hasEncryptedVault: true,
                masterKeySalt: saltHex,
                encryptedVaultKey,
              });
            }

            onUnlocked(key);
            onClose();
          }
        } else {
          // Unlock Mode: verify PIN
          const key = await VaultCryptoService.verifyVaultPin(
            enteredPin,
            currentUser.masterKeySalt!,
            currentUser.encryptedVaultKey!
          );

          if (!key) {
            triggerError('Incorrect 4-digit PIN');
            setIsProcessing(false);
            return;
          }

          // Save derived key to session storage for seamless tab usage
          await VaultCryptoService.exportKeyToSession(key);
          onUnlocked(key);
          onClose();
        }
      } catch (err: any) {
        triggerError(err.message || 'Verification failed. Try again.');
      } finally {
        setIsProcessing(false);
      }
    },
    [isSetupMode, setupStep, firstPin, currentUser, triggerError, onUnlocked, onClose, onUserUpdated]
  );

  const handleDigit = useCallback(
    (digit: string) => {
      if (isProcessing) return;
      if (pin.length < 4) {
        const next = pin + digit;
        setPin(next);
        setError('');
        if (next.length === 4) {
          setTimeout(() => handleCompletePin(next), 60);
        }
      }
    },
    [pin, isProcessing, handleCompletePin]
  );

  const handleDelete = useCallback(() => {
    if (isProcessing) return;
    setPin((prev) => prev.slice(0, -1));
    setError('');
  }, [isProcessing]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleDelete();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleDigit, handleDelete, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity animate-in fade-in"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div
        className={`relative w-full max-w-sm rounded-3xl bg-[#121217] border border-amber-500/25 p-7 shadow-2xl z-10 text-white transition-all transform animate-in zoom-in-95 ${
          shake ? 'animate-shake' : ''
        }`}
        style={{
          boxShadow: '0 0 50px -10px rgba(245, 158, 11, 0.15), 0 25px 50px -12px rgba(0, 0, 0, 0.85)',
        }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 text-zinc-400 hover:text-white rounded-full hover:bg-white/5 transition"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Vault Header Icon */}
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-600/30 to-yellow-500/10 border border-amber-500/30 flex items-center justify-center mb-4 text-amber-400 shadow-lg shadow-amber-500/10">
            {isProcessing ? (
              <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
            ) : isSetupMode ? (
              <KeyRound className="w-7 h-7 text-amber-400" />
            ) : (
              <Lock className="w-7 h-7 text-amber-400" />
            )}
          </div>

          <h2 className="text-lg font-bold text-white tracking-wide">
            {isSetupMode
              ? setupStep === 1
                ? 'Create 4-Digit Vault PIN'
                : 'Confirm 4-Digit PIN'
              : 'Unlock Private Vault'}
          </h2>

          <p className="text-xs text-zinc-400 mt-1.5 max-w-[260px] leading-relaxed">
            {isSetupMode
              ? setupStep === 1
                ? 'Choose a 4-digit PIN. Your vault is zero-knowledge encrypted and can only be opened with this PIN.'
                : 'Please re-enter your 4-digit PIN to confirm setup.'
              : 'Enter your 4-digit secret PIN to decrypt your zero-knowledge private vault.'}
          </p>

          <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] font-semibold text-amber-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>Zero-Knowledge • AES-256-GCM</span>
          </div>
        </div>

        {/* 4-Digit Indicator Dots */}
        <div className="flex justify-center items-center gap-4 my-7">
          {[0, 1, 2, 3].map((index) => {
            const isFilled = pin.length > index;
            return (
              <div
                key={index}
                className={`w-4 h-4 rounded-full transition-all duration-200 transform ${
                  isFilled
                    ? 'bg-amber-400 scale-125 shadow-[0_0_12px_rgba(251,191,36,0.8)]'
                    : 'bg-zinc-800 border border-zinc-700/80'
                }`}
              />
            );
          })}
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-center justify-center gap-1.5 text-xs text-red-400 mb-4 animate-in fade-in">
            <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-3 max-w-[240px] mx-auto">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              onClick={() => handleDigit(digit)}
              disabled={isProcessing}
              className="h-14 rounded-2xl bg-zinc-900/80 hover:bg-amber-500/15 border border-zinc-800 hover:border-amber-500/30 text-lg font-semibold text-zinc-100 hover:text-amber-300 active:scale-95 transition-all flex items-center justify-center select-none"
            >
              {digit}
            </button>
          ))}

          {/* Clear button */}
          <button
            onClick={() => {
              setPin('');
              setError('');
            }}
            disabled={isProcessing || pin.length === 0}
            className="h-14 rounded-2xl bg-zinc-900/40 hover:bg-zinc-800 text-xs font-semibold text-zinc-400 hover:text-zinc-200 active:scale-95 transition-all flex items-center justify-center select-none disabled:opacity-30 disabled:pointer-events-none"
          >
            Clear
          </button>

          {/* 0 digit */}
          <button
            onClick={() => handleDigit('0')}
            disabled={isProcessing}
            className="h-14 rounded-2xl bg-zinc-900/80 hover:bg-amber-500/15 border border-zinc-800 hover:border-amber-500/30 text-lg font-semibold text-zinc-100 hover:text-amber-300 active:scale-95 transition-all flex items-center justify-center select-none"
          >
            0
          </button>

          {/* Delete / Backspace */}
          <button
            onClick={handleDelete}
            disabled={isProcessing || pin.length === 0}
            className="h-14 rounded-2xl bg-zinc-900/40 hover:bg-zinc-800 text-zinc-300 hover:text-white active:scale-95 transition-all flex items-center justify-center select-none disabled:opacity-30 disabled:pointer-events-none"
            aria-label="Backspace"
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>

        {/* Security disclaimer footer */}
        <div className="mt-6 text-center text-[10px] text-zinc-400">
          <p>Files uploaded here are encrypted in your browser RAM.</p>
          <p className="mt-0.5 text-zinc-400">Google Drive cannot inspect your filenames, photos, or documents.</p>
        </div>
      </div>
    </div>
  );
};
