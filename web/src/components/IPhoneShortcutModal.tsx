import React, { useState, useEffect } from 'react';
import {
  X,
  Apple,
  Download,
  Smartphone,
  Zap,
  Shield,
  Check,
  QrCode,
  ExternalLink,
  BatteryCharging,
  Clock,
  Wifi,
  Camera,
  Sparkles,
  Info,
} from 'lucide-react';
import { api } from '../services/api.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialTab?: 'shortcuts' | 'automations';
}

export const IPhoneShortcutModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSuccess,
  initialTab = 'shortcuts',
}) => {
  const [deviceName, setDeviceName] = useState('My iPhone');
  const [autoSyncUrl, setAutoSyncUrl] = useState('');
  const [uploadUrl, setUploadUrl] = useState('');
  const [step, setStep] = useState<'name' | 'install'>('name');
  const [activeTab, setActiveTab] = useState<'shortcuts' | 'automations'>(initialTab);
  const [selectedTrigger, setSelectedTrigger] = useState<'charger' | 'time' | 'wifi' | 'camera'>('charger');
  const [copiedAuto, setCopiedAuto] = useState(false);
  const [copiedUpload, setCopiedUpload] = useState(false);

  // Rebuild download URLs whenever deviceName changes
  useEffect(() => {
    if (step === 'install') {
      setAutoSyncUrl(api.getShortcutDownloadUrl('auto-sync', deviceName));
      setUploadUrl(api.getShortcutDownloadUrl('upload', deviceName));
    }
  }, [step, deviceName]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const handleContinue = () => {
    if (!deviceName.trim()) return;
    setAutoSyncUrl(api.getShortcutDownloadUrl('auto-sync', deviceName));
    setUploadUrl(api.getShortcutDownloadUrl('upload', deviceName));
    setStep('install');
    onSuccess(); // refresh device list
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

  const triggerGuides = {
    charger: {
      title: 'When Connected to Power',
      badge: 'Recommended',
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
      icon: BatteryCharging,
      color: 'text-emerald-400',
      summary: 'Backs up camera roll every night when you plug your phone in to charge.',
      steps: [
        'Open the Shortcuts app on your iPhone and tap the Automation tab at the bottom.',
        'Tap + (or New Automation) and select Charger.',
        'Choose "Is Connected" and select Run Immediately (make sure "Ask Before Running" is turned OFF).',
        'Tap Next → Choose "Run Shortcut" → Pick "myDrive Auto Sync" → Tap Done ✅.',
      ],
    },
    time: {
      title: 'Time of Day (e.g. 2:00 AM)',
      badge: 'Scheduled',
      badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
      icon: Clock,
      color: 'text-purple-400',
      summary: 'Runs a silent backup check every night at a specific time.',
      steps: [
        'Open Shortcuts → Automation tab → tap + (New Automation).',
        'Choose Time of Day → Set to 2:00 AM (or your preferred time) → Select Daily.',
        'Choose Run Immediately (turn OFF "Ask Before Running").',
        'Tap Next → Select "Run Shortcut" → Choose "myDrive Auto Sync" → Done ✅.',
      ],
    },
    wifi: {
      title: 'When Joining Home Wi-Fi',
      badge: 'Location-aware',
      badgeColor: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
      icon: Wifi,
      color: 'text-sky-400',
      summary: 'Automatically backs up when you arrive home and reconnect to your Wi-Fi.',
      steps: [
        'Open Shortcuts → Automation tab → tap + (New Automation).',
        'Choose Wi-Fi → Tap Network and select your Home Wi-Fi.',
        'Select Run Immediately.',
        'Tap Next → Choose "Run Shortcut" → Select "myDrive Auto Sync" → Done ✅.',
      ],
    },
    camera: {
      title: 'When Camera App Closes',
      badge: 'Instant',
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      icon: Camera,
      color: 'text-amber-400',
      summary: 'Syncs new photos immediately right after you take pictures and exit the Camera.',
      steps: [
        'Open Shortcuts → Automation tab → tap + (New Automation).',
        'Choose App → Choose Camera → Select "Is Closed" (uncheck "Is Opened").',
        'Select Run Immediately.',
        'Tap Next → Choose "Run Shortcut" → Select "myDrive Auto Sync" → Done ✅.',
      ],
    },
  };

  const currentTrigger = triggerGuides[selectedTrigger];

  return (
    <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4 backdrop-blur-md">
      <div className="bg-[#0e0e12] border border-[#25253a] rounded-3xl max-w-xl w-full shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
        {/* Ambient glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-violet-600/8 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="relative px-6 pt-6 pb-4 border-b border-[#1c1c28] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-gradient-to-br from-purple-600/30 to-violet-700/30 border border-purple-500/40 rounded-2xl shadow-glow-purple">
              <Apple className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base tracking-tight">iPhone Backup &amp; Automations</h3>
              <p className="text-[11px] text-zinc-400">Zero-setup shortcuts with background auto-sync</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-500 hover:text-white rounded-full hover:bg-zinc-800/60 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === 'name' ? (
          /* ── STEP 1: Name your device ─────────────────────────── */
          <div className="relative px-6 py-6 space-y-6 overflow-y-auto">
            <div className="flex items-start space-x-3 p-4 bg-purple-950/30 border border-purple-800/40 rounded-2xl">
              <Zap className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-bold text-purple-200">How it works</p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  We generate a secure <strong className="text-zinc-200">.shortcut file</strong> with your credentials
                  already embedded. Open it on your iPhone — iOS imports it instantly into the Shortcuts app.{' '}
                  <strong className="text-zinc-200">No copy-pasting keys required.</strong>
                </p>
              </div>
            </div>

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

            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: Shield, label: 'Secure key', color: 'text-emerald-400' },
                { icon: Zap, label: 'Auto-sync', color: 'text-amber-400' },
                { icon: Download, label: 'Dedup skip', color: 'text-sky-400' },
              ].map(({ icon: Icon, label, color }) => (
                <div
                  key={label}
                  className="flex flex-col items-center space-y-1.5 p-3 bg-[#14141c] border border-[#22222e] rounded-2xl"
                >
                  <Icon className={`w-4 h-4 ${color}`} />
                  <span className="text-[10px] text-zinc-400 font-semibold">{label}</span>
                </div>
              ))}
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
          /* ── STEP 2: Shortcuts & Automations Tabs ──────────────── */
          <div className="relative px-6 py-5 space-y-5 overflow-y-auto">
            {/* Top Navigation Tabs */}
            <div className="flex p-1 bg-[#13131b] border border-[#232332] rounded-2xl">
              <button
                onClick={() => setActiveTab('shortcuts')}
                className={`flex-1 flex items-center justify-center space-x-2 py-2 text-xs font-bold rounded-xl transition ${
                  activeTab === 'shortcuts'
                    ? 'bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow-glow-purple'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/40'
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>1. Install Shortcuts</span>
              </button>
              <button
                onClick={() => setActiveTab('automations')}
                className={`flex-1 flex items-center justify-center space-x-2 py-2 text-xs font-bold rounded-xl transition ${
                  activeTab === 'automations'
                    ? 'bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow-glow-purple'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/40'
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>2. Automations Tab Guide</span>
              </button>
            </div>

            {/* TAB 1: SHORTCUTS INSTALL */}
            {activeTab === 'shortcuts' && (
              <div className="space-y-4">
                <div className="flex items-center space-x-2.5 p-3.5 bg-emerald-950/40 border border-emerald-800/50 rounded-2xl">
                  <div className="w-7 h-7 flex items-center justify-center bg-emerald-900/60 rounded-full border border-emerald-700/50">
                    <Check className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-emerald-300">Device Ready!</p>
                    <p className="text-[11px] text-zinc-400">
                      <code className="text-emerald-300 font-mono text-[10px]">{deviceName}</code> — credentials
                      embedded in your shortcut files below.
                    </p>
                  </div>
                </div>

                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  <strong className="text-white">Download these .shortcut files</strong> or AirDrop them to your
                  iPhone. iOS will auto-import each shortcut into the Shortcuts app.
                </p>

                {/* Auto-Sync Shortcut Card */}
                <div className="p-4 bg-[#131320] border border-purple-800/40 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center">
                        <Zap className="w-4 h-4 text-purple-400" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white">myDrive Auto Sync</p>
                        <p className="text-[10px] text-zinc-500">Backs up new photos • Runs via Automation</p>
                      </div>
                    </div>
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-purple-950/70 border border-purple-700/50 text-purple-300">
                      Background Sync
                    </span>
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
                      title="Copy install link to open in iPhone Safari"
                      className="px-3.5 py-2.5 text-xs font-bold text-zinc-300 bg-[#1e1e2d] border border-[#2e2e42] rounded-xl hover:border-purple-500/50 transition active:scale-95"
                    >
                      {copiedAuto ? <Check className="w-4 h-4 text-emerald-400" /> : <QrCode className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Manual Upload Shortcut Card */}
                <div className="p-4 bg-[#131320] border border-zinc-700/40 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-xl bg-sky-600/20 border border-sky-500/30 flex items-center justify-center">
                        <Download className="w-4 h-4 text-sky-400" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white">myDrive Upload</p>
                        <p className="text-[10px] text-zinc-500">Manual pick &amp; upload • Share Sheet</p>
                      </div>
                    </div>
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-sky-950/70 border border-sky-700/50 text-sky-300">
                      Manual Picker
                    </span>
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
                      title="Copy install link to open in iPhone Safari"
                      className="px-3.5 py-2.5 text-xs font-bold text-zinc-300 bg-[#1e1e2d] border border-[#2e2e42] rounded-xl hover:border-sky-500/50 transition active:scale-95"
                    >
                      {copiedUpload ? <Check className="w-4 h-4 text-emerald-400" /> : <QrCode className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Switch to Automations banner */}
                <div
                  onClick={() => setActiveTab('automations')}
                  className="p-3.5 bg-gradient-to-r from-purple-950/40 to-violet-950/30 border border-purple-800/40 rounded-2xl flex items-center justify-between cursor-pointer hover:border-purple-500/60 transition group"
                >
                  <div className="flex items-center space-x-2.5">
                    <Sparkles className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-white">Ready for hands-free background sync?</p>
                      <p className="text-[10px] text-zinc-400">Set it up in the Shortcuts Automation tab →</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-purple-400 group-hover:translate-x-1 transition duration-200">
                    View Guide →
                  </span>
                </div>
              </div>
            )}

            {/* TAB 2: AUTOMATIONS TAB GUIDE */}
            {activeTab === 'automations' && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Hands-Free Automation Setup
                  </h4>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Select a trigger to see the exact 4 steps to configure in the iPhone Shortcuts{' '}
                    <strong className="text-zinc-200">Automation tab</strong>:
                  </p>
                </div>

                {/* 4 Trigger Chips */}
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { key: 'charger', label: 'When Charging', icon: BatteryCharging, sub: 'Overnight sync' },
                      { key: 'time', label: 'Time of Day', icon: Clock, sub: 'Daily at 2:00 AM' },
                      { key: 'wifi', label: 'Home Wi-Fi', icon: Wifi, sub: 'On reconnect' },
                      { key: 'camera', label: 'Camera Closes', icon: Camera, sub: 'Instant photo sync' },
                    ] as const
                  ).map(({ key, label, icon: Icon, sub }) => (
                    <button
                      key={key}
                      onClick={() => setSelectedTrigger(key)}
                      className={`p-3 rounded-2xl border text-left transition flex items-start space-x-2.5 ${
                        selectedTrigger === key
                          ? 'bg-purple-950/50 border-purple-500 shadow-glow-purple'
                          : 'bg-[#14141c] border-[#22222e] hover:border-zinc-700 text-zinc-400'
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                          selectedTrigger === key ? 'text-purple-400' : 'text-zinc-500'
                        }`}
                      />
                      <div className="space-y-0.5 overflow-hidden">
                        <p className={`text-xs font-bold truncate ${selectedTrigger === key ? 'text-white' : 'text-zinc-300'}`}>
                          {label}
                        </p>
                        <p className="text-[10px] text-zinc-500 truncate">{sub}</p>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Selected Trigger Instructions */}
                <div className="p-4 bg-[#131320] border border-purple-800/40 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between pb-1 border-b border-[#212133]">
                    <div className="flex items-center space-x-2">
                      <currentTrigger.icon className={`w-4 h-4 ${currentTrigger.color}`} />
                      <span className="text-xs font-bold text-white">{currentTrigger.title}</span>
                    </div>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${currentTrigger.badgeColor}`}>
                      {currentTrigger.badge}
                    </span>
                  </div>

                  <p className="text-[11px] text-zinc-400 italic">{currentTrigger.summary}</p>

                  <div className="space-y-2 pt-1">
                    {currentTrigger.steps.map((st, idx) => (
                      <div key={idx} className="flex items-start space-x-2.5">
                        <span className="w-5 h-5 rounded-full bg-purple-900/60 border border-purple-700/60 text-purple-300 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <p className="text-xs text-zinc-300 leading-relaxed">{st}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Dedup pro tip */}
                <div className="p-3 bg-purple-950/20 border border-purple-900/30 rounded-2xl flex items-start space-x-2.5">
                  <Info className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    <strong className="text-purple-300">Set up multiple triggers:</strong> You can create both{' '}
                    <strong>Charger</strong> and <strong>Home Wi-Fi</strong> automations. The myDrive server checks
                    SHA-256 hashes in milliseconds and skips duplicates without re-uploading bytes to Google Drive.
                  </p>
                </div>
              </div>
            )}

            {/* Modal Bottom Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-[#1c1c28]">
              <button
                onClick={() => setStep('name')}
                className="text-xs text-zinc-500 hover:text-zinc-300 font-semibold transition"
              >
                ← Back to Rename
              </button>
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
