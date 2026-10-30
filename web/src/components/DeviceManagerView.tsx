import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DeviceItem, FileItem, FolderItem, SyncLogEntry } from '../types.js';
import {
  Smartphone,
  Apple,
  Laptop,
  Wifi,
  BatteryCharging,
  Plus,
  Trash2,
  Image as ImageIcon,
  Film,
  FileText,
  FolderOpen,
  X,
  RefreshCw,
  Download,
  Activity,
  Clock,
  ChevronDown,
  Zap,
  CheckCircle2,
  AlertCircle,
  Key,
  Copy,
  Check,
  Search,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../services/api.js';
import { formatBytes } from '../utils/format.js';

interface Props {
  devices: DeviceItem[];
  onRefresh: () => void;
  onOpenIPhoneModal: () => void;
  selectedLogDevice?: DeviceItem | null;
  onCloseLogModal?: () => void;
}

export const DeviceManagerView: React.FC<Props> = ({
  devices,
  onRefresh,
  onOpenIPhoneModal,
  selectedLogDevice,
  onCloseLogModal,
}) => {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [inspectDevice, setInspectDevice] = useState<DeviceItem | null>(null);
  const [inspectFiles, setInspectFiles] = useState<FileItem[]>([]);
  const [inspectLoading, setInspectLoading] = useState<boolean>(false);
  const [viewingLogsDevice, setViewingLogsDevice] = useState<DeviceItem | null>(selectedLogDevice || null);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [foldersLoading, setFoldersLoading] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<'all' | 'processing' | 'dedup' | 'uploaded' | 'revived' | 'errors'>('all');
  const [logSearch, setLogSearch] = useState<string>('');
  const [isClearingLogs, setIsClearingLogs] = useState<boolean>(false);

  // Sync external log modal trigger
  useEffect(() => {
    if (selectedLogDevice) {
      setViewingLogsDevice(selectedLogDevice);
    }
  }, [selectedLogDevice]);

  // Keep viewingLogsDevice synced with live devices state
  useEffect(() => {
    if (viewingLogsDevice) {
      const updated = devices.find((d) => d._id === viewingLogsDevice._id);
      if (updated) {
        setViewingLogsDevice(updated);
      }
    }
  }, [devices]);

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleClearLogs = async (deviceDocId: string) => {
    if (!confirm('Are you sure you want to clear sync logs for this device?')) return;
    try {
      setIsClearingLogs(true);
      await api.clearDeviceLogs(deviceDocId);
      onRefresh();
    } catch (err: any) {
      alert(`Failed to clear logs: ${err.message}`);
    } finally {
      setIsClearingLogs(false);
    }
  };

  const getLogIcon = (msg: string) => {
    const lower = msg.toLowerCase();
    if (lower.includes('✓') || lower.includes('backed up') || lower.includes('uploaded') || lower.includes('saved')) {
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />;
    }
    if (lower.includes('⚡') || lower.includes('up to date') || lower.includes('duplicate') || lower.includes('skipped') || lower.includes('linked')) {
      return <Zap className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />;
    }
    if (lower.includes('🔄') || lower.includes('restored') || lower.includes('revived')) {
      return <RefreshCw className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />;
    }
    if (lower.includes('error') || lower.includes('failed') || lower.includes('interrupted')) {
      return <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
    }
    return <Clock className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />;
  };

  const cleanLogMessage = (msg: string) => {
    return msg.replace(/^[\s\u200B]*[✓⚡🔄⚠️☁️📸]\s*/, '').trim();
  };

  const getInferredLevel = (msg: string): 'info' | 'processing' | 'uploaded' | 'duplicate' | 'revived' | 'error' => {
    const lower = msg.toLowerCase();
    if (lower.includes('processing') || lower.includes('checking') || lower.includes('streaming')) return 'processing';
    if (lower.includes('⚡') || lower.includes('duplicate') || lower.includes('up to date') || lower.includes('skipped') || lower.includes('linked')) return 'duplicate';
    if (lower.includes('✓') || lower.includes('backed up') || lower.includes('uploaded') || lower.includes('saved')) return 'uploaded';
    if (lower.includes('🔄') || lower.includes('restored') || lower.includes('revived')) return 'revived';
    if (lower.includes('error') || lower.includes('failed') || lower.includes('interrupted')) return 'error';
    return 'info';
  };

  const getLogLevelBadge = (log: SyncLogEntry) => {
    const level = log.level || getInferredLevel(log.message);
    switch (level) {
      case 'processing':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-950/60 text-amber-300 border border-amber-800/40 animate-pulse flex-shrink-0">
            PROCESSING
          </span>
        );
      case 'duplicate':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-950/60 text-purple-300 border border-purple-800/40 flex-shrink-0">
            DUPLICATE DETECTED
          </span>
        );
      case 'uploaded':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-800/40 flex-shrink-0">
            BACKED UP
          </span>
        );
      case 'revived':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-950/60 text-sky-300 border border-sky-800/40 flex-shrink-0">
            RESTORED
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-950/60 text-red-300 border border-red-800/40 flex-shrink-0">
            ERROR
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-zinc-900 text-zinc-400 border border-zinc-800 flex-shrink-0">
            INFO
          </span>
        );
    }
  };

  // Load all user folders for destination folder selection
  useEffect(() => {
    let isMounted = true;
    const loadFolders = async () => {
      try {
        setFoldersLoading(true);
        const res = await api.listFolders(undefined, true);
        if (isMounted) {
          setFolders(res.folders || []);
        }
      } catch (err) {
        console.error('Failed to load folders for device manager:', err);
      } finally {
        if (isMounted) {
          setFoldersLoading(false);
        }
      }
    };
    loadFolders();
    return () => {
      isMounted = false;
    };
  }, []);

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case 'iphone':
        return <Apple className="w-5 h-5 text-white" />;
      case 'android':
        return <Smartphone className="w-5 h-5 text-purple-400" />;
      default:
        return <Laptop className="w-5 h-5 text-zinc-300" />;
    }
  };

  const handleTogglePolicy = async (device: DeviceItem, key: any) => {
    try {
      setLoadingId(device._id);
      await api.updateDevicePolicy(device._id, {
        ...device.policy,
        [key]: !device.policy[key as keyof typeof device.policy],
      });
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoadingId(null);
    }
  };

  const handleTargetFolderChange = async (device: DeviceItem, folderId: string) => {
    try {
      setLoadingId(device._id);
      const targetFolderId = folderId ? folderId : null;
      await api.updateDevicePolicy(device._id, {
        ...device.policy,
        targetFolderId,
      });
      onRefresh();
    } catch (err: any) {
      alert(`Failed to update destination folder: ${err.message}`);
    } finally {
      setLoadingId(null);
    }
  };

  const handleOpenUploads = async (device: DeviceItem) => {
    setInspectDevice(device);
    setInspectLoading(true);
    try {
      const res = await api.getDeviceUploads(device.deviceId);
      setInspectFiles(res.files || []);
    } catch (err: any) {
      alert(`Failed to load device uploads: ${err.message}`);
      setInspectFiles([]);
    } finally {
      setInspectLoading(false);
    }
  };

  const handleRevoke = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to revoke "${name}"? If you lost your phone, this cuts off access immediately.`)) {
      return;
    }
    try {
      await api.revokeDevice(id);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRegisterAndroidDev = async () => {
    const name = prompt('Enter Android device name:', 'Karan Pixel 9');
    if (!name) return;
    try {
      const res = await api.registerDevice({
        deviceName: name,
        deviceType: 'android',
      });
      alert(`Android Device Registered!\n\nDevice ID: ${res.device.deviceId}\nDevice Key: ${res.rawApiKey}\n\nSave this key into your Android app.`);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleResetKey = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to reset the pairing key for "${name}"? You will need to enter the new key on your device to reconnect.`)) {
      return;
    }
    try {
      const res = await api.resetDeviceKey(id);
      alert(`Key Reset Successful for ${name}!\n\nDevice ID: ${res.deviceId}\nNew Device Key: ${res.rawApiKey}\n\nPlease enter this new key in your Android app to reconnect.`);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Connected Devices</h2>
          <p className="text-xs text-zinc-400">
            Per-device upload policies, battery/Wi-Fi constraints, and instant key revocation
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleRegisterAndroidDev}
            className="flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-zinc-300 bg-[#15151b] hover:bg-[#1f1f27] border border-[#272733] rounded-full transition active:scale-95 shadow-sm"
          >
            <Smartphone className="w-3.5 h-3.5 text-purple-400" />
            <span>Pair Android</span>
          </button>
          <button
            onClick={onOpenIPhoneModal}
            className="flex items-center space-x-1.5 px-5 py-2 text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-violet-500 hover:from-purple-500 hover:to-violet-400 rounded-full shadow-glow-purple transition active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Pair iPhone Shortcut</span>
          </button>
        </div>
      </div>

      {devices.length === 0 ? (
        <div className="bg-[#111114] border border-[#222227] rounded-3xl p-12 text-center text-zinc-500 space-y-2">
          <Smartphone className="w-10 h-10 mx-auto text-zinc-700" />
          <p className="text-sm font-semibold text-zinc-300">No physical devices paired yet</p>
          <p className="text-xs text-zinc-500">
            Click &quot;Pair iPhone Shortcut&quot; or &quot;Pair Android&quot; to set up automatic mobile backups.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {devices.map((device) => (
            <div
              key={device._id}
              className="bg-[#111114] border border-[#222227] hover:border-purple-500/30 rounded-3xl p-6 shadow-xl space-y-5 transition duration-300 group"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3.5">
                  <div className="p-3 bg-[#181820] border border-[#272733] rounded-2xl group-hover:border-purple-500/40 transition">
                    {getDeviceIcon(device.deviceType)}
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-bold text-white text-sm flex items-center space-x-2">
                      <span>{device.deviceName}</span>
                      {device.osVersion && (
                        <span className="text-[10px] text-zinc-500 font-normal">({device.osVersion})</span>
                      )}
                    </h3>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
                      <div className="flex items-center space-x-1 bg-[#171722] px-2 py-0.5 rounded-md border border-[#272738]">
                        <span className="text-zinc-500 text-[10px]">ID:</span>
                        <code className="text-zinc-300 font-mono text-[10px]">{device.deviceId}</code>
                        <button
                          onClick={() => handleCopyText(device.deviceId, `dev_${device._id}`)}
                          title="Copy Device ID"
                          className="ml-1 text-zinc-500 hover:text-white transition"
                        >
                          {copiedKey === `dev_${device._id}` ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>

                      {device.apiKeyPrefix && (
                        <div className="flex items-center space-x-1 bg-[#171722] px-2 py-0.5 rounded-md border border-[#272738]" title="Device Pairing Key Prefix">
                          <Key className="w-3 h-3 text-amber-400/80 flex-shrink-0" />
                          <code className="text-amber-300/80 font-mono text-[10px]">{device.apiKeyPrefix}••••</code>
                        </div>
                      )}

                      <span className="text-[10px] text-zinc-500 ml-0.5">
                        • Last seen: {new Date(device.lastSeenAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                </div>

                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                    device.status === 'syncing'
                      ? 'bg-purple-950/60 text-purple-300 border-purple-500/50 shadow-glow-purple animate-pulse'
                      : device.status === 'online'
                      ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                      : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                      device.status === 'syncing'
                        ? 'bg-purple-400 animate-ping'
                        : device.status === 'online'
                        ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                        : 'bg-zinc-600'
                    }`}
                  />
                  {device.status.toUpperCase()}
                </span>
              </div>

              {/* Real-time Activity & Sync Logs Console directly on Device Card */}
              <div className="bg-[#14141c] border border-[#22222d] rounded-2xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Activity className="w-3.5 h-3.5 text-purple-400" />
                    <span className="text-xs font-bold text-zinc-200">Sync Activity &amp; Logs</span>
                    {device.syncLogs && device.syncLogs.length > 0 && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-purple-950/60 text-purple-300 border border-purple-800/40 font-mono">
                        {device.syncLogs.length}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => setViewingLogsDevice(device)}
                    className="text-[11px] text-purple-400 hover:text-purple-300 font-semibold transition flex items-center space-x-0.5"
                  >
                    <span>View All Logs</span>
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>

                {/* Live Activity Status Banner */}
                <div
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl border text-xs font-medium ${
                    device.status === 'syncing'
                      ? 'bg-purple-950/40 text-purple-200 border-purple-700/50 shadow-glow-purple'
                      : 'bg-[#181824] text-zinc-300 border-[#252538]'
                  }`}
                >
                  {device.status === 'syncing' ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-400 flex-shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  )}
                  <span className="truncate">
                    {device.currentSyncActivity || 'Idle (Camera roll synced and up to date)'}
                  </span>
                </div>

                {/* Inline 3-4 Recent Logs with Filename, Status Badge & Details */}
                {device.syncLogs && device.syncLogs.length > 0 ? (
                  <div className="space-y-1.5 font-mono text-[11px]">
                    {[...device.syncLogs].slice(-4).reverse().map((log, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-xl bg-[#181824]/90 border border-[#232334] text-zinc-300 space-y-1 hover:border-purple-500/30 transition"
                      >
                        <div className="flex items-center justify-between gap-1 text-[10px]">
                          <div className="flex items-center space-x-1.5 min-w-0">
                            {getLogIcon(log.message)}
                            {getLogLevelBadge(log)}
                            <span className="font-bold text-white truncate font-sans text-xs">
                              {log.filename || cleanLogMessage(log.message)}
                            </span>
                          </div>
                          <div className="flex items-center space-x-1.5 flex-shrink-0 text-zinc-500 font-sans text-[10px]">
                            {log.sizeBytes && (
                              <span className="px-1.5 py-0.2 rounded bg-[#20202e] text-zinc-300 font-mono text-[9px] border border-[#28283a]">
                                {formatBytes(log.sizeBytes)}
                              </span>
                            )}
                            <span>
                              {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                        </div>

                        {log.details && (
                          <p className="text-[10px] text-zinc-400 font-sans pl-5 leading-relaxed line-clamp-2">
                            {log.details}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-zinc-500 italic px-1">
                    No sync logs recorded yet. Events will stream here live.
                  </p>
                )}
              </div>

              {/* Policy Controls */}
              <div className="bg-[#16161d] border border-[#22222c] rounded-2xl p-4 space-y-3 text-xs">
                <div className="font-bold text-zinc-500 text-[10px] uppercase tracking-wider">
                  Sync & Network Constraints
                </div>

                <div className="flex items-center justify-between">
                  <span className="flex items-center text-zinc-300 font-medium">
                    <Wifi className="w-3.5 h-3.5 mr-2 text-purple-400" />
                    Wi-Fi Only Uploads
                  </span>
                  <button
                    onClick={() => handleTogglePolicy(device, 'wifiOnly')}
                    disabled={loadingId === device._id}
                    className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-wider transition ${
                      device.policy?.wifiOnly
                        ? 'bg-purple-600 text-white shadow-glow-purple'
                        : 'bg-[#22222c] text-zinc-400'
                    }`}
                  >
                    {device.policy?.wifiOnly ? 'ENABLED' : 'DISABLED'}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="flex items-center text-zinc-300 font-medium">
                    <BatteryCharging className="w-3.5 h-3.5 mr-2 text-amber-400" />
                    Charging Only Uploads
                  </span>
                  <button
                    onClick={() => handleTogglePolicy(device, 'chargingOnly')}
                    disabled={loadingId === device._id}
                    className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-wider transition ${
                      device.policy?.chargingOnly
                        ? 'bg-amber-600 text-white shadow-[0_0_10px_#f59e0b]'
                        : 'bg-[#22222c] text-zinc-400'
                    }`}
                  >
                    {device.policy?.chargingOnly ? 'ENABLED' : 'DISABLED'}
                  </button>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#202029] text-zinc-400 text-[11px]">
                  <span>Local Phone Deletion:</span>
                  <span className="font-semibold text-emerald-400">Keep in Cloud (Safe)</span>
                </div>

                <div className="pt-2 border-t border-[#202029] space-y-2">
                  <div className="font-bold text-zinc-500 text-[10px] uppercase tracking-wider">
                    Personalized Media & Paired Policy
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      onClick={() => handleTogglePolicy(device, 'syncPhotos')}
                      disabled={loadingId === device._id}
                      className={`flex items-center justify-center space-x-1 py-1.5 px-2 rounded-xl text-[10px] font-bold border transition ${
                        device.policy?.syncPhotos !== false
                          ? 'bg-purple-950/40 text-purple-300 border-purple-800/60'
                          : 'bg-zinc-900 text-zinc-600 border-zinc-800'
                      }`}
                    >
                      <ImageIcon className="w-3 h-3" />
                      <span>Photos</span>
                    </button>
                    <button
                      onClick={() => handleTogglePolicy(device, 'syncVideos')}
                      disabled={loadingId === device._id}
                      className={`flex items-center justify-center space-x-1 py-1.5 px-2 rounded-xl text-[10px] font-bold border transition ${
                        device.policy?.syncVideos !== false
                          ? 'bg-purple-950/40 text-purple-300 border-purple-800/60'
                          : 'bg-zinc-900 text-zinc-600 border-zinc-800'
                      }`}
                    >
                      <Film className="w-3 h-3" />
                      <span>Videos</span>
                    </button>
                    <button
                      onClick={() => handleTogglePolicy(device, 'syncDocuments')}
                      disabled={loadingId === device._id}
                      className={`flex items-center justify-center space-x-1 py-1.5 px-2 rounded-xl text-[10px] font-bold border transition ${
                        device.policy?.syncDocuments !== false
                          ? 'bg-purple-950/40 text-purple-300 border-purple-800/60'
                          : 'bg-zinc-900 text-zinc-600 border-zinc-800'
                      }`}
                    >
                      <FileText className="w-3 h-3" />
                      <span>Docs</span>
                    </button>
                    <button
                      onClick={() => handleTogglePolicy(device, 'autoDownloadToGallery')}
                      disabled={loadingId === device._id}
                      title="Automatically download paired device media into native phone Gallery"
                      className={`flex items-center justify-center space-x-1 py-1.5 px-2 rounded-xl text-[10px] font-bold border transition ${
                        device.policy?.autoDownloadToGallery
                          ? 'bg-purple-950/60 text-purple-300 border-purple-600/80 shadow-glow-purple'
                          : 'bg-zinc-900 text-zinc-600 border-zinc-800'
                      }`}
                    >
                      <Download className="w-3 h-3" />
                      <span>Auto Gallery</span>
                    </button>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-[#202029] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center text-zinc-300 font-medium">
                      <FolderOpen className="w-3.5 h-3.5 mr-2 text-purple-400" />
                      Upload Destination Folder
                    </span>
                    {loadingId === device._id && (
                      <RefreshCw className="w-3 h-3 animate-spin text-purple-400" />
                    )}
                  </div>
                  <div className="relative">
                    <select
                      value={device.policy?.targetFolderId || ''}
                      disabled={loadingId === device._id || foldersLoading}
                      onChange={(e) => handleTargetFolderChange(device, e.target.value)}
                      className="w-full bg-[#111116] border border-[#272736] hover:border-purple-500/50 focus:border-purple-500 text-zinc-200 text-xs rounded-xl px-3 py-2 pr-8 appearance-none transition outline-none cursor-pointer disabled:opacity-50"
                    >
                      <option value="">📁 Root / Default (My Drive)</option>
                      {folders.map((f) => (
                        <option key={f._id} value={f._id}>
                          📁 {f.name} {f.path && f.path !== '/' ? `(${f.path})` : ''}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500">
                      <ChevronDown className="w-3.5 h-3.5" />
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-500">
                    Photos & documents uploaded by this device will automatically be saved into this folder.
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => setViewingLogsDevice(device)}
                    className="flex items-center space-x-1.5 text-xs text-purple-400 hover:text-purple-300 font-semibold transition"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Sync Activity & Logs</span>
                  </button>

                  <button
                    onClick={() => handleOpenUploads(device)}
                    className="flex items-center space-x-1.5 text-xs text-zinc-400 hover:text-white font-semibold transition"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Uploaded Docs</span>
                  </button>

                  {device.deviceType === 'iphone' && (
                    <button
                      onClick={onOpenIPhoneModal}
                      className="flex items-center space-x-1.5 text-xs text-amber-400 hover:text-amber-300 font-semibold transition"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>Automations &amp; Shortcuts</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center space-x-4">
                  <button
                    onClick={() => handleResetKey(device._id, device.deviceName)}
                    className="flex items-center space-x-1.5 text-xs text-blue-400/80 hover:text-blue-400 font-semibold transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Reset Key</span>
                  </button>

                  <button
                    onClick={() => handleRevoke(device._id, device.deviceName)}
                    className="flex items-center space-x-1.5 text-xs text-red-400/80 hover:text-red-400 font-semibold transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Revoke</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Uploaded Docs Inspection Modal */}
      {inspectDevice && createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#13131a] border border-[#27273a] rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-[#22222d] flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-[#1e1e28] border border-[#2e2e3e] rounded-xl text-purple-400">
                  <FolderOpen className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">
                    Uploaded by {inspectDevice.deviceName}
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Device ID: <code className="text-purple-300">{inspectDevice.deviceId}</code>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectDevice(null)}
                className="p-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-800/60 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-3">
              {inspectLoading ? (
                <div className="py-12 flex flex-col items-center justify-center space-y-3 text-zinc-400">
                  <RefreshCw className="w-6 h-6 animate-spin text-purple-500" />
                  <p className="text-xs">Loading files uploaded by this device...</p>
                </div>
              ) : inspectFiles.length === 0 ? (
                <div className="py-12 text-center text-zinc-500 space-y-2">
                  <FolderOpen className="w-10 h-10 mx-auto text-zinc-700" />
                  <p className="text-sm font-medium text-zinc-300">No files uploaded yet</p>
                  <p className="text-xs text-zinc-500">
                    When this device backs up photos, videos, or documents, they will be listed here.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-zinc-400 px-1">
                    Total Files: <span className="text-white font-bold">{inspectFiles.length}</span>
                  </div>
                  {inspectFiles.map((f) => (
                    <div
                      key={f._id}
                      className="flex items-center justify-between p-3 bg-[#181822] border border-[#252533] rounded-2xl hover:border-purple-500/30 transition"
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className="p-2 bg-[#20202d] rounded-xl text-purple-400 flex-shrink-0">
                          {f.mimeType.startsWith('image/') ? (
                            <ImageIcon className="w-4 h-4" />
                          ) : f.mimeType.startsWith('video/') ? (
                            <Film className="w-4 h-4" />
                          ) : (
                            <FileText className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">{f.filename}</p>
                          <p className="text-[10px] text-zinc-400">
                            {formatBytes(f.sizeBytes)} • {new Date(f.createdAt).toLocaleDateString()}
                            {f.folderId ? ' • In Folder' : ' • Root'}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-purple-950/60 text-purple-300 border border-purple-800/40">
                        Cloud Stored
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-[#22222d] bg-[#101016] flex justify-end">
              <button
                onClick={() => setInspectDevice(null)}
                className="px-5 py-2 text-xs font-bold text-white bg-[#22222d] hover:bg-[#2c2c3d] rounded-full transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Live Sync Activity & Logs Modal */}
      {viewingLogsDevice && createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#13131a] border border-[#27273a] rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-[#22222d] flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-[#1e1e28] border border-[#2e2e3e] rounded-xl text-purple-400">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base flex items-center space-x-2">
                    <span>{viewingLogsDevice.deviceName}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                        viewingLogsDevice.status === 'syncing'
                          ? 'bg-purple-950/60 text-purple-300 border-purple-500/50 shadow-glow-purple animate-pulse'
                          : viewingLogsDevice.status === 'online'
                          ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                          : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                      }`}
                    >
                      {viewingLogsDevice.status.toUpperCase()}
                    </span>
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Device ID: <code className="text-purple-300">{viewingLogsDevice.deviceId}</code>
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setViewingLogsDevice(null);
                  if (onCloseLogModal) onCloseLogModal();
                }}
                className="p-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-800/60 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {/* Current Live Activity */}
              <div className="bg-[#181822] border border-[#272738] rounded-2xl p-4 space-y-1.5">
                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex items-center space-x-1.5">
                  <Clock className="w-3.5 h-3.5 text-purple-400" />
                  <span>Current Activity</span>
                </div>
                <p className="text-sm font-semibold text-white flex items-center space-x-2">
                  {viewingLogsDevice.status === 'syncing' && (
                    <RefreshCw className="w-4 h-4 animate-spin text-purple-400 flex-shrink-0" />
                  )}
                  <span>{viewingLogsDevice.currentSyncActivity || 'Idle (Waiting for next scheduled sync)'}</span>
                </p>
                <p className="text-[11px] text-zinc-400">
                  Last seen active: {new Date(viewingLogsDevice.lastSeenAt).toLocaleString()}
                </p>
              </div>

              {/* Sync Schedule & Stagger Status */}
              <div className="bg-[#181822] border border-[#272738] rounded-2xl p-4 space-y-2">
                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  Auto-Sync Schedule & Collision Prevention
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-[#121219] p-2.5 rounded-xl border border-[#22222d]">
                    <span className="text-zinc-500 block text-[10px]">Interval</span>
                    <span className="font-bold text-zinc-200">
                      Every {viewingLogsDevice.policy?.syncIntervalHours || 2} hours
                    </span>
                  </div>
                  <div className="bg-[#121219] p-2.5 rounded-xl border border-[#22222d]">
                    <span className="text-zinc-500 block text-[10px]">Collision Protection</span>
                    <span className="font-bold text-emerald-400">
                      Staggered Slot Active
                    </span>
                  </div>
                </div>
              </div>

              {/* Live Logs List with Search, Filter Tabs & Actions */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
                  <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center space-x-1.5">
                    <span>Full Activity &amp; Deduplication History</span>
                    <span className="text-zinc-500 font-mono">({(viewingLogsDevice.syncLogs || []).length})</span>
                  </div>

                  <div className="flex items-center space-x-2">
                    {viewingLogsDevice.syncLogs && viewingLogsDevice.syncLogs.length > 0 && (
                      <>
                        <button
                          onClick={() => {
                            const text = viewingLogsDevice.syncLogs?.map((l) => `[${new Date(l.timestamp).toISOString()}] ${l.message}`).join('\n') || '';
                            handleCopyText(text, 'all_logs');
                          }}
                          className="flex items-center space-x-1 text-[11px] text-zinc-400 hover:text-white px-2.5 py-1 rounded-lg bg-[#181824] border border-[#262638] transition"
                        >
                          {copiedKey === 'all_logs' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedKey === 'all_logs' ? 'Copied' : 'Copy All'}</span>
                        </button>

                        <button
                          onClick={() => handleClearLogs(viewingLogsDevice._id)}
                          disabled={isClearingLogs}
                          className="flex items-center space-x-1 text-[11px] text-red-400/80 hover:text-red-300 px-2.5 py-1 rounded-lg bg-red-950/20 border border-red-900/40 transition disabled:opacity-50"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Clear Logs</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Filter Tabs & Search Bar */}
                {viewingLogsDevice.syncLogs && viewingLogsDevice.syncLogs.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => setLogFilter('all')}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                          logFilter === 'all'
                            ? 'bg-purple-600 text-white shadow-glow-purple'
                            : 'bg-[#151520] text-zinc-400 hover:text-white border border-[#232332]'
                        }`}
                      >
                        All ({(viewingLogsDevice.syncLogs || []).length})
                      </button>
                      <button
                        onClick={() => setLogFilter('processing')}
                        className={`flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-semibold transition ${
                          logFilter === 'processing'
                            ? 'bg-amber-600 text-white shadow-[0_0_10px_#f59e0b]'
                            : 'bg-[#151520] text-zinc-400 hover:text-amber-300 border border-[#232332]'
                        }`}
                      >
                        <RefreshCw className="w-3 h-3 text-amber-400" />
                        <span>Processing</span>
                      </button>
                      <button
                        onClick={() => setLogFilter('dedup')}
                        className={`flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-semibold transition ${
                          logFilter === 'dedup'
                            ? 'bg-purple-700 text-white shadow-glow-purple'
                            : 'bg-[#151520] text-zinc-400 hover:text-purple-300 border border-[#232332]'
                        }`}
                      >
                        <Zap className="w-3 h-3 text-purple-400" />
                        <span>Duplicates</span>
                      </button>
                      <button
                        onClick={() => setLogFilter('uploaded')}
                        className={`flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-semibold transition ${
                          logFilter === 'uploaded'
                            ? 'bg-emerald-600 text-white shadow-[0_0_10px_#10b981]'
                            : 'bg-[#151520] text-zinc-400 hover:text-emerald-300 border border-[#232332]'
                        }`}
                      >
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span>Backed Up</span>
                      </button>
                      <button
                        onClick={() => setLogFilter('revived')}
                        className={`flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-semibold transition ${
                          logFilter === 'revived'
                            ? 'bg-sky-600 text-white shadow-[0_0_10px_#0284c7]'
                            : 'bg-[#151520] text-zinc-400 hover:text-sky-300 border border-[#232332]'
                        }`}
                      >
                        <RefreshCw className="w-3 h-3 text-sky-400" />
                        <span>Restored</span>
                      </button>
                      <button
                        onClick={() => setLogFilter('errors')}
                        className={`flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-semibold transition ${
                          logFilter === 'errors'
                            ? 'bg-red-600 text-white shadow-[0_0_10px_#ef4444]'
                            : 'bg-[#151520] text-zinc-400 hover:text-red-300 border border-[#232332]'
                        }`}
                      >
                        <AlertCircle className="w-3 h-3 text-red-400" />
                        <span>Issues</span>
                      </button>
                    </div>

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                      <input
                        type="text"
                        value={logSearch}
                        onChange={(e) => setLogSearch(e.target.value)}
                        placeholder="Search logs by filename or keyword..."
                        className="w-full bg-[#111118] border border-[#232334] focus:border-purple-500 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 outline-none transition"
                      />
                    </div>
                  </div>
                )}

                {/* Log entries */}
                {(!viewingLogsDevice.syncLogs || viewingLogsDevice.syncLogs.length === 0) ? (
                  <div className="p-8 text-center text-zinc-500 bg-[#14141d] rounded-2xl border border-[#22222e]">
                    <Activity className="w-8 h-8 mx-auto text-zinc-600 mb-2" />
                    <p className="text-xs font-semibold text-zinc-400">No sync logs recorded yet</p>
                    <p className="text-[11px] text-zinc-600 mt-0.5">Logs will stream here in real time as the device syncs.</p>
                  </div>
                ) : (
                  <div className="space-y-2 font-mono text-xs max-h-72 overflow-y-auto pr-1">
                    {[...viewingLogsDevice.syncLogs]
                      .reverse()
                      .filter((entry) => {
                        const level = entry.level || getInferredLevel(entry.message);
                        if (logFilter === 'processing' && level !== 'processing') return false;
                        if (logFilter === 'dedup' && level !== 'duplicate') return false;
                        if (logFilter === 'uploaded' && level !== 'uploaded') return false;
                        if (logFilter === 'revived' && level !== 'revived') return false;
                        if (logFilter === 'errors' && level !== 'error') return false;
                        if (logSearch.trim()) {
                          const query = logSearch.toLowerCase().trim();
                          const inMsg = entry.message.toLowerCase().includes(query);
                          const inName = entry.filename?.toLowerCase().includes(query) || false;
                          const inDetails = entry.details?.toLowerCase().includes(query) || false;
                          return inMsg || inName || inDetails;
                        }
                        return true;
                      })
                      .map((entry, i) => (
                        <div
                          key={i}
                          className="bg-[#14141e] border border-[#232332] p-3 rounded-2xl space-y-1.5 text-zinc-300 hover:border-purple-500/30 transition"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center space-x-2 min-w-0">
                              {getLogIcon(entry.message)}
                              {getLogLevelBadge(entry)}
                              <span className="font-bold text-white text-xs truncate">
                                {entry.filename || cleanLogMessage(entry.message)}
                              </span>
                            </div>

                            <div className="flex items-center space-x-2 text-zinc-500 text-[10px] font-sans flex-shrink-0">
                              {entry.sizeBytes && (
                                <span className="px-1.5 py-0.5 rounded bg-[#1e1e2d] text-zinc-300 font-mono text-[9px] border border-[#2b2b3d]">
                                  {formatBytes(entry.sizeBytes)}
                                </span>
                              )}
                              <span className="text-purple-400 font-mono">
                                {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                            </div>
                          </div>

                          {entry.details && (
                            <div className="text-[11px] text-zinc-400 font-sans pl-5 leading-relaxed bg-[#101016]/60 p-2 rounded-xl border border-[#1d1d29]">
                              {entry.details}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-[#22222d] bg-[#101016] flex justify-end">
              <button
                onClick={() => {
                  setViewingLogsDevice(null);
                  if (onCloseLogModal) onCloseLogModal();
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-[#22222d] hover:bg-[#2c2c3d] rounded-full transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
