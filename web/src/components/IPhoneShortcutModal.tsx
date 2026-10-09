import React, { useState, useEffect } from 'react';
import { X, Apple, Download, Smartphone, Zap, Shield, Check, QrCode, ExternalLink } from 'lucide-react';
import { api } from '../services/api.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const IPhoneShortcutModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const [deviceName, setDeviceName] = useState('My iPhone');
  const [autoSyncUrl, setAutoSyncUrl] = useState('');
  const [uploadUrl, setUploadUrl] = useState('');
  const [step, setStep] = useState<'name' | 'install'>('name');
  const [copiedAuto, setCopiedAuto] = useState(false);
  const [copiedUpload, setCopiedUpload] = useState(false);

  // Rebuild download URLs whenever deviceName changes
  useEffect(() => {
    if (step === 'install') {
      setAutoSyncUrl(api.getShortcutDownloadUrl('auto-sync', deviceName));
      setUploadUrl(api.getShortcutDownloadUrl('upload', deviceName));
    }
  }, [step, deviceName]);

  if (!isOpen) return null;

  const handleContinue = () => {
    if (!deviceName.trim()) return;
    setAutoSyncUrl(api.getShortcutDownloadUrl('auto-sync', deviceName));
    setUploadUrl(api.getShortcutDownloadUrl('upload', deviceName));
    setStep('install');
    onSuccess(); // refresh device list (device is created on download)
  };

  const copyToClipboard = (url: string, which: 'auto' | 'upload') => {
    navigator.clipboard.writeText(url);
    if (which === 'auto') {
      setCopiedAuto(true);
      setTimeout(() => setCopiedAuto(false), 2500);
    } else {
      setCopiedUpload(true);
      setTimeout(() => setCopiedUpload(false), 2500);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4 backdrop-blur-md">
      <div className="bg-[#0e0e12] border border-[#25253a] rounded-3xl max-w-lg w-full shadow-2xl relative overflow-hidden">
        {/* Purple gradient glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-violet-600/8 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="relative px-6 pt-6 pb-4 border-b border-[#1c1c28] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-gradient-to-br from-purple-600/30 to-violet-700/30 border border-purple-500/40 rounded-2xl shadow-glow-purple">
              <Apple className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base tracking-tight">Install iPhone Shortcut</h3>
              <p className="text-[11px] text-zinc-400">Zero manual setup — one tap installs everything</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-500 hover:text-white rounded-full hover:bg-zinc-800/60 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === 'name' ? (
          /* ── STEP 1: Name your device ─────────────────────────── */
          <div className="relative px-6 py-6 space-y-6">
            {/* How it works callout */}
            <div className="flex items-start space-x-3 p-4 bg-purple-950/30 border border-purple-800/40 rounded-2xl">
              <Zap className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-bold text-purple-200">How it works</p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  We generate a secure <strong className="text-zinc-200">.shortcut file</strong> with your
                  credentials already embedded. Open it on your iPhone — iOS imports it instantly into the
                  Shortcuts app. <strong className="text-zinc-200">No copy-pasting keys required.</strong>
                </p>
              </div>
            </div>

            {/* Device name input */}
            <div>
              <label className="block text-xs font-bold text-zinc-300 mb-2 uppercase tracking-wider">
                Device Name
              </label>
              <div className="relative">
                <Smartphone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="e.g. Karan iPhone 15 Pro"
                  className="w-full pl-10 pr-4 py-2.5 bg-[#181820] border border-[#272733] rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
                />
              </div>
              <p className="text-[10px] text-zinc-500 mt-1.5 pl-1">
                This name appears in your Device Dashboard to identify this iPhone.
              </p>
            </div>

            {/* Feature pills */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: Shield, label: 'Secure key', color: 'text-emerald-400' },
                { icon: Zap, label: 'Auto-sync', color: 'text-amber-400' },
                { icon: Download, label: 'Dedup skip', color: 'text-sky-400' },
              ].map(({ icon: Icon, label, color }) => (
                <div key={label} className="flex flex-col items-center space-y-1.5 p-3 bg-[#14141c] border border-[#22222e] rounded-2xl">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <span className="text-[10px] text-zinc-400 font-semibold">{label}</span>
                </div>
              ))}
            </div>

            {/* CTA */}
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:bg-[#181820] rounded-full transition"
              >
                Cancel
              </button>
              <button
                onClick={handleContinue}
                disabled={!deviceName.trim()}
                className="flex items-center space-x-2 px-5 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-violet-500 rounded-full shadow-glow-purple hover:from-purple-500 hover:to-violet-400 transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>Generate Install Links</span>
                <Zap className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          /* ── STEP 2: Download buttons ──────────────────────────── */
          <div className="relative px-6 py-6 space-y-5">

            {/* Success callout */}
            <div className="flex items-center space-x-2.5 p-3.5 bg-emerald-950/40 border border-emerald-800/50 rounded-2xl">
              <div className="w-7 h-7 flex items-center justify-center bg-emerald-900/60 rounded-full border border-emerald-700/50">
                <Check className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-bold text-emerald-300">Device Ready!</p>
                <p className="text-[11px] text-zinc-400">
                  <code className="text-emerald-300 font-mono text-[10px]">{deviceName}</code> — credentials embedded in your shortcut files below.
                </p>
              </div>
            </div>

            {/* Main instruction */}
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              <strong className="text-white">Open these links directly on your iPhone</strong> (e.g. scan the
              QR from your Mac, or AirDrop this page). iOS will auto-import each shortcut into the Shortcuts app.
            </p>

            {/* Auto-Sync Shortcut */}
            <div className="p-4 bg-[#131320] border border-purple-800/40 rounded-2xl space-y-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <p className="text-xs font-bold text-white">myDrive Auto Sync</p>
                  <p className="text-[10px] text-zinc-500">Backs up new photos since last sync • Runs via Automation</p>
                </div>
              </div>
              <div className="flex space-x-2">
                <a
                  href={autoSyncUrl}
                  className="flex-1 flex items-center justify-center space-x-2 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-violet-500 rounded-xl shadow-glow-purple hover:from-purple-500 hover:to-violet-400 transition active:scale-95"
                  download="myDrive Auto Sync.shortcut"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download &amp; Install</span>
                </a>
                <button
                  onClick={() => copyToClipboard(autoSyncUrl, 'auto')}
                  title="Copy link to open on iPhone"
                  className="px-3.5 py-2.5 text-xs font-bold text-zinc-300 bg-[#1e1e2d] border border-[#2e2e42] rounded-xl hover:border-purple-500/50 transition active:scale-95"
                >
                  {copiedAuto ? <Check className="w-4 h-4 text-emerald-400" /> : <QrCode className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Upload Shortcut */}
            <div className="p-4 bg-[#131320] border border-zinc-700/40 rounded-2xl space-y-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-xl bg-sky-600/20 border border-sky-500/30 flex items-center justify-center">
                  <Download className="w-4 h-4 text-sky-400" />
                </div>
                <div>
                  <p className="text-xs font-bold text-white">myDrive Upload</p>
                  <p className="text-[10px] text-zinc-500">Manual pick &amp; upload • Share Sheet support</p>
                </div>
              </div>
              <div className="flex space-x-2">
                <a
                  href={uploadUrl}
                  className="flex-1 flex items-center justify-center space-x-2 py-2.5 text-xs font-bold text-white bg-[#1a1a28] border border-sky-700/50 rounded-xl hover:bg-[#20203a] hover:border-sky-500/60 transition active:scale-95"
                  download="myDrive Upload.shortcut"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
                  <span>Download &amp; Install</span>
                </a>
                <button
                  onClick={() => copyToClipboard(uploadUrl, 'upload')}
                  title="Copy link to open on iPhone"
                  className="px-3.5 py-2.5 text-xs font-bold text-zinc-300 bg-[#1e1e2d] border border-[#2e2e42] rounded-xl hover:border-sky-500/50 transition active:scale-95"
                >
                  {copiedUpload ? <Check className="w-4 h-4 text-emerald-400" /> : <QrCode className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* After install steps */}
            <div className="p-3.5 bg-[#111119] border border-[#22222e] rounded-2xl space-y-2">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">After installing Auto Sync:</p>
              <ol className="list-decimal list-inside space-y-1 text-[11px] text-zinc-500 pl-1">
                <li>Go to <strong className="text-zinc-300">Settings → Shortcuts → Advanced</strong> → Enable <strong className="text-zinc-300">Allow Running Scripts</strong></li>
                <li>In Shortcuts → <strong className="text-zinc-300">Automation</strong> → <strong className="text-zinc-300">+</strong> → Choose <strong className="text-zinc-300">Charger</strong> → "Is Connected"</li>
                <li>Add action: <strong className="text-zinc-300">Run Shortcut</strong> → select <strong className="text-zinc-300">myDrive Auto Sync</strong></li>
                <li>Disable "Ask Before Running" → tap <strong className="text-zinc-300">Done</strong> ✅</li>
              </ol>
            </div>

            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-6 py-2 text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-violet-500 rounded-full shadow-glow-purple hover:from-purple-500 hover:to-violet-400 transition active:scale-95"
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
