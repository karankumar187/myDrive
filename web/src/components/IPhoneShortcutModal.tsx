import React, { useState } from 'react';
import { X, Apple, Copy, Check, ShieldCheck } from 'lucide-react';
import { api } from '../services/api.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const IPhoneShortcutModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const [deviceName, setDeviceName] = useState('My iPhone');
  const [loading, setLoading] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const res = await api.registerDevice({
        deviceName,
        deviceType: 'iphone',
      });
      setGeneratedKey(res.rawApiKey);
      setDeviceId(res.device.deviceId);
      onSuccess();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-md">
      <div className="bg-[#111114] border border-[#272733] rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl space-y-6 relative overflow-hidden">
        {/* Glow */}
        <div className="absolute top-0 right-0 w-48 h-48 bg-purple-600/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-center justify-between border-b border-[#1c1c24] pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-[#181822] text-white border border-[#262636] rounded-2xl shadow-glow-purple">
              <Apple className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base tracking-tight">Pair iPhone Shortcut</h3>
              <p className="text-xs text-zinc-400">Automatic background backup without an App Store app</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!generatedKey ? (
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-zinc-300 mb-1.5 uppercase tracking-wider">
                iPhone Device Name
              </label>
              <input
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder="e.g. Karan iPhone 15 Pro"
                className="w-full px-4 py-2.5 bg-[#181820] border border-[#272733] rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
                required
              />
            </div>

            <div className="p-3.5 bg-purple-950/30 border border-purple-800/40 text-purple-300 text-xs rounded-2xl space-y-1">
              <p className="font-bold text-white">How this works:</p>
              <p className="text-[11px] leading-relaxed">
                We generate a secure Device API Key. You copy it into the Apple Shortcut on your iPhone. The Shortcut runs in the background when connected to Wi-Fi and power.
              </p>
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
                className="px-5 py-2 text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-violet-500 rounded-full shadow-glow-purple hover:from-purple-500 hover:to-violet-400 transition active:scale-95 disabled:opacity-50"
              >
                Generate Device Key
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-purple-950/40 border border-purple-800/50 rounded-2xl space-y-2.5">
              <div className="flex items-center space-x-2 text-purple-300 font-bold text-xs">
                <ShieldCheck className="w-4 h-4 text-purple-400" />
                <span>Device Registered Successfully!</span>
              </div>
              <p className="text-[11px] text-zinc-400">
                This Device Key will only be displayed once. Copy and paste it into your iPhone Shortcut:
              </p>

              <div className="flex items-center space-x-2 bg-[#121217] p-2.5 rounded-xl border border-[#292938]">
                <code className="text-xs font-mono text-purple-200 truncate flex-1">{generatedKey}</code>
                <button
                  onClick={copyToClipboard}
                  className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1 shadow-glow-purple transition active:scale-95"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {/* Step-by-step Setup Guide */}
            <div className="space-y-2 text-xs text-zinc-300">
              <h4 className="font-bold text-white">Setup Instructions for iOS:</h4>
              <ol className="list-decimal list-inside space-y-1.5 pl-1 text-zinc-400 text-[11px]">
                <li>Open the built-in <strong>Shortcuts</strong> app on your iPhone.</li>
                <li>Import or create <strong>CloudSync</strong> shortcut.</li>
                <li>Paste your <strong>Device Key</strong> and ID (<code className="bg-[#181820] text-purple-300 px-1 py-0.5 rounded">{deviceId}</code>).</li>
                <li>In Shortcuts → <strong>Automation</strong> → tap <strong>&quot;When connected to power&quot;</strong> → Run CloudSync.</li>
              </ol>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={onClose}
                className="px-6 py-2 text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-violet-500 rounded-full shadow-glow-purple hover:from-purple-500 hover:to-violet-400 transition"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
