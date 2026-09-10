import React, { useState, useEffect, useCallback } from 'react';
import { Fingerprint, Delete, Lock, AlertCircle } from 'lucide-react';
import { LockSecurityService } from '../services/lock-security.js';

interface LockScreenProps {
  userName: string;
  userAvatar?: string;
  onUnlock: () => void;
  onForgotPin: () => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({
  userName,
  userAvatar,
  onUnlock,
  onForgotPin,
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [failCount, setFailCount] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const MAX_PIN_LENGTH = 6;
  const MAX_ATTEMPTS = 5;
  const COOLDOWN_SECONDS = 30;

  // Check biometric on mount and auto-trigger
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const available = await LockSecurityService.isBiometricAvailable();
      const registered = LockSecurityService.isBiometricRegistered();
      if (cancelled) return;
      setBiometricAvailable(available && registered);

      // Auto-trigger biometric prompt on mount
      if (available && registered) {
        try {
          const ok = await LockSecurityService.authenticateBiometric();
          if (!cancelled && ok) onUnlock();
        } catch { /* user cancelled */ }
      }
    };
    init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          setFailCount(0);
          setError('');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleDigit = useCallback((digit: string) => {
    if (cooldown > 0) return;
    setError('');
    setPin(prev => {
      if (prev.length >= MAX_PIN_LENGTH) return prev;
      return prev + digit;
    });
  }, [cooldown]);

  const handleDelete = useCallback(() => {
    setPin(prev => prev.slice(0, -1));
    setError('');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (pin.length < 4) {
      setError('PIN must be at least 4 digits');
      return;
    }
    const valid = await LockSecurityService.verifyPin(pin);
    if (valid) {
      onUnlock();
    } else {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      const newFails = failCount + 1;
      setFailCount(newFails);
      setPin('');
      if (newFails >= MAX_ATTEMPTS) {
        setCooldown(COOLDOWN_SECONDS);
        setError(`Too many attempts. Try again in ${COOLDOWN_SECONDS}s`);
      } else {
        setError(`Wrong PIN (${MAX_ATTEMPTS - newFails} attempts left)`);
      }
    }
  }, [pin, failCount, onUnlock]);

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (cooldown > 0) return;
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleDelete();
      } else if (e.key === 'Enter' && pin.length >= 4) {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDigit, handleDelete, handleSubmit, pin.length, cooldown]);

  const handleBiometric = async () => {
    try {
      const ok = await LockSecurityService.authenticateBiometric();
      if (ok) onUnlock();
      else setError('Biometric authentication failed');
    } catch {
      setError('Biometric authentication cancelled');
    }
  };

  const firstName = userName.split(' ')[0] || 'there';

  return (
    <div className="min-h-screen bg-[#08080a] text-white flex flex-col items-center justify-center p-4 relative overflow-hidden select-none">
      {/* Background glow */}
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-purple-600/15 rounded-full blur-[140px] pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center space-y-8 w-full max-w-xs">
        {/* Avatar & greeting */}
        <div className="flex flex-col items-center space-y-3">
          {userAvatar ? (
            <img
              src={userAvatar}
              alt=""
              className="w-20 h-20 rounded-full border-2 border-purple-500/40 shadow-lg shadow-purple-900/30"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-purple-600/30 border-2 border-purple-500/40 flex items-center justify-center">
              <Lock className="w-8 h-8 text-purple-400" />
            </div>
          )}
          <div className="text-center">
            <p className="text-lg font-semibold text-white">
              Welcome back, {firstName}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">Enter your PIN to unlock</p>
          </div>
        </div>

        {/* PIN dots */}
        <div
          className="flex items-center justify-center space-x-3"
          style={shake ? { animation: 'shake 0.5s ease-in-out' } : undefined}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`w-3.5 h-3.5 rounded-full transition-all duration-200 ${
                i < pin.length
                  ? 'bg-purple-400 scale-110 shadow-[0_0_8px_rgba(168,85,247,0.5)]'
                  : 'bg-zinc-700/50 border border-zinc-600/50'
              }`}
            />
          ))}
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-center space-x-1.5 text-red-400 text-xs font-medium animate-pulse">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>
              {cooldown > 0
                ? `Too many attempts. Try again in ${cooldown}s`
                : error}
            </span>
          </div>
        )}

        {/* Number pad */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-[260px]">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit => (
            <button
              key={digit}
              onClick={() => handleDigit(digit)}
              disabled={cooldown > 0}
              className="h-16 rounded-2xl bg-[#151518] border border-[#222228] text-2xl font-semibold text-white hover:bg-[#1e1e24] active:bg-purple-600/20 active:border-purple-500/40 transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {digit}
            </button>
          ))}

          {/* Bottom row: biometric / 0 / delete-or-submit */}
          <button
            onClick={biometricAvailable ? handleBiometric : undefined}
            disabled={!biometricAvailable || cooldown > 0}
            className={`h-16 rounded-2xl border flex items-center justify-center transition-all duration-150 ${
              biometricAvailable
                ? 'bg-[#151518] border-[#222228] hover:bg-purple-600/15 active:bg-purple-600/30 text-purple-400 cursor-pointer'
                : 'bg-transparent border-transparent cursor-default'
            }`}
          >
            {biometricAvailable && <Fingerprint className="w-6 h-6" />}
          </button>

          <button
            onClick={() => handleDigit('0')}
            disabled={cooldown > 0}
            className="h-16 rounded-2xl bg-[#151518] border border-[#222228] text-2xl font-semibold text-white hover:bg-[#1e1e24] active:bg-purple-600/20 active:border-purple-500/40 transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            0
          </button>

          <button
            onClick={pin.length >= 4 ? handleSubmit : handleDelete}
            disabled={cooldown > 0 || (pin.length < 1 && pin.length < 4)}
            className="h-16 rounded-2xl bg-[#151518] border border-[#222228] flex items-center justify-center hover:bg-[#1e1e24] active:bg-purple-600/20 transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {pin.length >= 4 ? (
              <svg
                className="w-6 h-6 text-purple-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <Delete className="w-5 h-5 text-zinc-400" />
            )}
          </button>
        </div>

        {/* Forgot PIN */}
        <button
          onClick={onForgotPin}
          className="text-xs text-zinc-500 hover:text-purple-400 transition-colors duration-200 mt-2"
        >
          Forgot PIN? Sign in again to reset
        </button>
      </div>

      {/* Shake keyframe (inline since we need it available) */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-6px); }
          20%, 40%, 60%, 80% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
};
