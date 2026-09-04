import React, { useState } from 'react';
import { Shield, Lock, Check, X, KeyRound } from 'lucide-react';
import { VaultCryptoService } from '../services/vault-crypto.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onVaultUnlocked: (key: CryptoKey) => void;
  saltHex?: string;
}

export const VaultModal: React.FC<Props> = ({ isOpen, onClose, onVaultUnlocked, saltHex }) => {
  const [passphrase, setPassphrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase || passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const salt = saltHex || '0123456789abcdef0123456789abcdef';
      const derivedKey = await VaultCryptoService.deriveKeyFromPassphrase(passphrase, salt);
      await VaultCryptoService.exportKeyToSession(derivedKey);
      onVaultUnlocked(derivedKey);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to derive encryption key');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-md">
      <div className="bg-[#111114] border border-[#272733] rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl space-y-5 relative overflow-hidden">
        {/* Ambient purple glow */}
        <div className="absolute top-0 right-0 w-44 h-44 bg-purple-600/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-center justify-between border-b border-[#1c1c24] pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-purple-950/40 text-purple-400 border border-purple-800/40 rounded-2xl shadow-glow-purple">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base tracking-tight">Zero-Knowledge Vault</h3>
              <p className="text-xs text-zinc-400">Client-Side End-to-End Encryption (E2EE)</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="text-xs text-zinc-400 space-y-2.5">
          <p className="leading-relaxed">
            Enter your <strong>Master Passphrase</strong> to unlock in-memory decryption. All files and photos are encrypted with <strong>AES-256-GCM</strong> in your browser before uploading.
          </p>
          <div className="p-3.5 bg-purple-950/30 border border-purple-800/40 text-purple-300 rounded-2xl text-[11px] flex items-start space-x-2.5">
            <Lock className="w-4 h-4 flex-shrink-0 mt-0.5 text-purple-400" />
            <span>
              Google Drive only receives opaque encrypted blobs (`.enc`). Google cannot scan your photos, read EXIF tags, or inspect contents.
            </span>
          </div>
        </div>

        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-zinc-300 mb-1.5 uppercase tracking-wider">
              Master Passphrase
            </label>
            <div className="relative">
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter passphrase (min 8 chars)"
                className="w-full pl-10 pr-4 py-2.5 bg-[#181820] border border-[#272733] rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
                autoFocus
              />
              <KeyRound className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
            </div>
            {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:bg-[#181820] rounded-full transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center space-x-1.5 px-6 py-2 text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-violet-500 rounded-full shadow-glow-purple hover:from-purple-500 hover:to-violet-400 transition active:scale-95 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{loading ? 'Deriving Key...' : 'Unlock Vault'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
