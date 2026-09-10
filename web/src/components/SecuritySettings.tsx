import React, { useState, useEffect } from 'react';
import { Shield, Fingerprint, Clock, X, Check, Lock, Eye, EyeOff } from 'lucide-react';
import { LockSecurityService } from '../services/lock-security.js';

interface SecuritySettingsProps {
  userId: string;
  userName: string;
  onClose: () => void;
  onPinChanged: () => void;
}

export const SecuritySettings: React.FC<SecuritySettingsProps> = ({
  userId,
  userName,
  onClose,
  onPinChanged,
}) => {
  const [isPinSet, setIsPinSet] = useState(LockSecurityService.isPinSet());
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricRegistered, setBiometricRegistered] = useState(
    LockSecurityService.isBiometricRegistered()
  );
  const [autoLockTimeout, setAutoLockTimeout] = useState(
    LockSecurityService.getAutoLockTimeout()
  );

  // PIN setup state
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinSuccess, setPinSuccess] = useState('');
  const [showPin, setShowPin] = useState(false);

  // Remove PIN state
  const [showRemovePin, setShowRemovePin] = useState(false);
  const [removePinInput, setRemovePinInput] = useState('');
  const [removeError, setRemoveError] = useState('');

  useEffect(() => {
    LockSecurityService.isBiometricAvailable().then(setBiometricAvailable);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleSetPin = async () => {
    setPinError('');
    if (newPin.length !== 4) {
      setPinError('PIN must be exactly 4 digits');
      return;
    }
    if (!/^\d{4}$/.test(newPin)) {
      setPinError('PIN must contain only digits');
      return;
    }
    if (newPin !== confirmPin) {
      setPinError('PINs do not match');
      return;
    }
    if (isPinSet) {
      const valid = await LockSecurityService.verifyPin(currentPin);
      if (!valid) {
        setPinError('Current PIN is incorrect');
        return;
      }
    }
    await LockSecurityService.setPin(newPin, userId);
    setIsPinSet(true);
    setShowPinSetup(false);
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setPinSuccess('PIN set successfully!');
    onPinChanged();
    setTimeout(() => setPinSuccess(''), 3000);
  };

  const handleRemovePin = async () => {
    const valid = await LockSecurityService.verifyPin(removePinInput);
    if (!valid) {
      setRemoveError('Incorrect PIN');
      return;
    }
    LockSecurityService.removePin();
    setIsPinSet(false);
    setBiometricRegistered(false);
    setShowRemovePin(false);
    setRemovePinInput('');
    setRemoveError('');
    onPinChanged();
  };

  const handleToggleBiometric = async () => {
    if (biometricRegistered) {
      localStorage.removeItem('drive_lock_biometric_cred');
      setBiometricRegistered(false);
    } else {
      const ok = await LockSecurityService.registerBiometric(userId, userName);
      setBiometricRegistered(ok);
      if (!ok) {
        // Could show an error, but the browser dialog already explains the failure
      }
    }
  };

  const handleAutoLockChange = (ms: number) => {
    setAutoLockTimeout(ms);
    LockSecurityService.setAutoLockTimeout(ms);
  };

  const autoLockOptions = [
    { label: 'Immediately', value: 0 },
    { label: 'After 1 min', value: 60000 },
    { label: 'After 5 min', value: 300000 },
    { label: 'After 15 min', value: 900000 },
    { label: 'After 30 min', value: 1800000 },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#111114] border border-[#222228] rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#1e1e24]">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-600/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Security</h2>
              <p className="text-[11px] text-zinc-500">Lock screen &amp; biometric</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-[#1a1a1f] flex items-center justify-center hover:bg-[#222228] transition"
          >
            <X className="w-4 h-4 text-zinc-400" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* ─── PIN Section ──────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Lock className="w-4 h-4 text-zinc-400" />
                <span className="text-sm font-medium text-white">PIN Lock</span>
              </div>
              {isPinSet && (
                <span className="text-[10px] font-semibold text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
                  Active
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Require a PIN every time you open myDrive to protect your files from
              unauthorized access.
            </p>

            {pinSuccess && (
              <div className="flex items-center space-x-1.5 text-green-400 text-xs bg-green-400/10 px-3 py-2.5 rounded-xl">
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{pinSuccess}</span>
              </div>
            )}

            {!showPinSetup && !showRemovePin && (
              <div className="flex space-x-2">
                <button
                  onClick={() => { setShowPinSetup(true); setPinError(''); }}
                  className="flex-1 py-2.5 rounded-xl bg-purple-600/15 text-purple-400 text-xs font-semibold hover:bg-purple-600/25 transition"
                >
                  {isPinSet ? 'Change PIN' : 'Set PIN'}
                </button>
                {isPinSet && (
                  <button
                    onClick={() => { setShowRemovePin(true); setRemoveError(''); }}
                    className="py-2.5 px-4 rounded-xl bg-red-500/10 text-red-400 text-xs font-semibold hover:bg-red-500/20 transition"
                  >
                    Remove
                  </button>
                )}
              </div>
            )}

            {/* Set / Change PIN Form */}
            {showPinSetup && (
              <div className="bg-[#0d0d10] rounded-2xl p-4 space-y-3 border border-[#1e1e24]">
                {isPinSet && (
                  <input
                    type={showPin ? 'text' : 'password'}
                    value={currentPin}
                    onChange={e =>
                      setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 4))
                    }
                    placeholder="Current 4-digit PIN"
                    maxLength={4}
                    className="w-full bg-[#151518] border border-[#2a2a30] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-purple-500/50 focus:outline-none transition tracking-widest text-center"
                    inputMode="numeric"
                    autoComplete="off"
                  />
                )}
                <div className="relative">
                  <input
                    type={showPin ? 'text' : 'password'}
                    value={newPin}
                    onChange={e =>
                      setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))
                    }
                    placeholder="New 4-digit PIN"
                    maxLength={4}
                    className="w-full bg-[#151518] border border-[#2a2a30] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-purple-500/50 focus:outline-none transition pr-10 tracking-widest text-center"
                    inputMode="numeric"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition"
                  >
                    {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <input
                  type={showPin ? 'text' : 'password'}
                  value={confirmPin}
                  onChange={e =>
                    setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))
                  }
                  placeholder="Confirm 4-digit PIN"
                  maxLength={4}
                  className="w-full bg-[#151518] border border-[#2a2a30] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-purple-500/50 focus:outline-none transition tracking-widest text-center"
                  inputMode="numeric"
                  autoComplete="off"
                />
                {pinError && (
                  <p className="text-xs text-red-400">{pinError}</p>
                )}
                <div className="flex space-x-2">
                  <button
                    onClick={handleSetPin}
                    className="flex-1 py-2.5 rounded-xl bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 transition"
                  >
                    {isPinSet ? 'Update PIN' : 'Set PIN'}
                  </button>
                  <button
                    onClick={() => {
                      setShowPinSetup(false);
                      setPinError('');
                      setCurrentPin('');
                      setNewPin('');
                      setConfirmPin('');
                    }}
                    className="py-2.5 px-4 rounded-xl bg-[#1a1a1f] text-zinc-400 text-xs font-semibold hover:bg-[#222228] transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Remove PIN Form */}
            {showRemovePin && (
              <div className="bg-[#0d0d10] rounded-2xl p-4 space-y-3 border border-red-500/20">
                <p className="text-xs text-red-400 font-medium">
                  Enter your current 4-digit PIN to disable lock screen
                </p>
                <input
                  type="password"
                  value={removePinInput}
                  onChange={e =>
                    setRemovePinInput(e.target.value.replace(/\D/g, '').slice(0, 4))
                  }
                  placeholder="Current 4-digit PIN"
                  maxLength={4}
                  className="w-full bg-[#151518] border border-[#2a2a30] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-red-500/50 focus:outline-none transition tracking-widest text-center"
                  inputMode="numeric"
                  autoComplete="off"
                />
                {removeError && (
                  <p className="text-xs text-red-400">{removeError}</p>
                )}
                <div className="flex space-x-2">
                  <button
                    onClick={handleRemovePin}
                    className="flex-1 py-2.5 rounded-xl bg-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/30 transition"
                  >
                    Remove PIN
                  </button>
                  <button
                    onClick={() => {
                      setShowRemovePin(false);
                      setRemoveError('');
                      setRemovePinInput('');
                    }}
                    className="py-2.5 px-4 rounded-xl bg-[#1a1a1f] text-zinc-400 text-xs font-semibold hover:bg-[#222228] transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ─── Divider ──────────────────────────────────── */}
          <div className="border-t border-[#1e1e24]" />

          {/* ─── Biometric Section ────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Fingerprint className="w-4 h-4 text-zinc-400" />
                <span className="text-sm font-medium text-white">Biometric Unlock</span>
              </div>
              <button
                onClick={handleToggleBiometric}
                disabled={!biometricAvailable || !isPinSet}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                  biometricRegistered ? 'bg-purple-600' : 'bg-zinc-700'
                } ${
                  !biometricAvailable || !isPinSet
                    ? 'opacity-30 cursor-not-allowed'
                    : 'cursor-pointer'
                }`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                    biometricRegistered ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              {!biometricAvailable
                ? 'Touch ID / Windows Hello not available on this device or browser'
                : !isPinSet
                ? 'Set a PIN first to enable biometric unlock'
                : biometricRegistered
                ? 'Fingerprint or face recognition will be used to unlock'
                : 'Use fingerprint or face recognition for faster unlock'}
            </p>
          </div>

          {/* ─── Divider ──────────────────────────────────── */}
          <div className="border-t border-[#1e1e24]" />

          {/* ─── Auto-lock Timing ─────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4 text-zinc-400" />
              <span className="text-sm font-medium text-white">Auto-lock After</span>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Automatically lock when you switch away from the myDrive tab
            </p>
            <div className="grid grid-cols-2 gap-2">
              {autoLockOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleAutoLockChange(opt.value)}
                  disabled={!isPinSet}
                  className={`py-2.5 px-3 rounded-xl text-xs font-medium transition-all ${
                    autoLockTimeout === opt.value && isPinSet
                      ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30'
                      : 'bg-[#151518] text-zinc-400 border border-[#222228] hover:border-[#333338]'
                  } ${!isPinSet ? 'opacity-30 cursor-not-allowed' : ''}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
