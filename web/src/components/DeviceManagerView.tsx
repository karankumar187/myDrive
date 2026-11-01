import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DeviceItem, FileItem, FolderItem } from '../types.js';
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
  ChevronDown,
  ChevronUp,
  Zap,
  CheckCircle2,
  Key,
  Copy,
  Check,
  Settings,
  Sliders,
  Folder,
} from 'lucide-react';
import { api } from '../services/api.js';
import { formatBytes } from '../utils/format.js';
import { DeviceLogViewerModal } from './DeviceLogViewerModal.js';

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
  const [isClearingLogs, setIsClearingLogs] = useState<boolean>(false);
  const [expandedSettingsIds, setExpandedSettingsIds] = useState<Set<string>>(new Set());

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

  const toggleSettings = (deviceId: string) => {
    setExpandedSettingsIds((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
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

  const getTargetFolderName = (targetFolderId?: string | null) => {
    if (!targetFolderId) return 'My Drive (Root)';
    const found = folders.find((f) => f._id === targetFolderId);
    return found ? found.name : 'Target Folder';
  };

  return (
    <div className="space-y-6">
      {/* Page Title & Pair Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Connected Devices</h2>
          <p className="text-xs text-zinc-400">
            Physical mobile devices paired for background photo and document backup
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {devices.map((device) => {
            const isSettingsExpanded = expandedSettingsIds.has(device._id);
            const logCount = (device.syncLogs || []).length;
            const targetFolderDisplay = getTargetFolderName(device.policy?.targetFolderId);

            return (
              <div
                key={device._id}
                className="bg-[#101016] border border-[#1e1e28] hover:border-purple-500/30 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4 transition duration-200"
              >
                {/* Header: Icon, Device Details, Status */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center space-x-3.5 min-w-0">
                    <div className="p-3 bg-[#181824] border border-[#272738] rounded-2xl shrink-0">
                      {getDeviceIcon(device.deviceType)}
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <h3 className="font-bold text-white text-sm truncate tracking-tight">
                          {device.deviceName}
                        </h3>
                        {device.osVersion && (
                          <span className="text-[10px] text-zinc-400 font-normal px-2 py-0.5 rounded-md bg-[#181822] border border-[#232332] shrink-0">
                            {device.osVersion}
                          </span>
                        )}
                      </div>

                      {/* Device ID and Key */}
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400 font-mono">
                        <span className="text-zinc-500 text-[10px]">ID:</span>
                        <code className="text-zinc-300 font-mono text-[10px] bg-[#161622] px-1.5 py-0.5 rounded border border-[#232334]">
                          {device.deviceId}
                        </code>
                        <button
                          onClick={() => handleCopyText(device.deviceId, `dev_${device._id}`)}
                          title="Copy Device ID"
                          className="text-zinc-500 hover:text-white transition p-0.5"
                        >
                          {copiedKey === `dev_${device._id}` ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>

                        {device.apiKeyPrefix && (
                          <span className="text-amber-400/90 text-[10px] ml-1">
                            Key: {device.apiKeyPrefix}••••
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  {(() => {
                    const isActivelySyncing = device.status === 'syncing' && (Date.now() - (device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0) < 45000);
                    const effectiveStatus = isActivelySyncing ? 'syncing' : (device.status === 'offline' ? 'offline' : 'online');
                    return (
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${
                          effectiveStatus === 'syncing'
                            ? 'bg-purple-950/60 text-purple-300 border-purple-500/50 shadow-glow-purple animate-pulse'
                            : effectiveStatus === 'online'
                            ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                            : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                            effectiveStatus === 'syncing'
                              ? 'bg-purple-400 animate-ping'
                              : effectiveStatus === 'online'
                              ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                              : 'bg-zinc-600'
                          }`}
                        />
                        {effectiveStatus.toUpperCase()}
                      </span>
                    );
                  })()}
                </div>

                {/* Status & Live Activity Banner */}
                {(() => {
                  const isActivelySyncing = device.status === 'syncing' && (Date.now() - (device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0) < 45000);
                  return (
                    <div
                      className={`flex items-center space-x-2.5 px-3.5 py-2 rounded-2xl border text-xs font-medium transition ${
                        isActivelySyncing
                          ? 'bg-purple-950/40 text-purple-200 border-purple-700/50 shadow-glow-purple'
                          : 'bg-[#151520] text-zinc-300 border-[#232332]'
                      }`}
                    >
                      {isActivelySyncing ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-400 shrink-0" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                      <span className="truncate">
                        {isActivelySyncing
                          ? (device.currentSyncActivity || 'Syncing photos...')
                          : 'Idle (Camera roll synced & up to date)'}
                      </span>
                    </div>
                  );
                })()}

                {/* Quick Info Grid: Destination Folder, Last Seen & Quick Stats */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-[#151520] border border-[#232332] rounded-2xl p-2.5 space-y-0.5">
                    <span className="text-[10px] text-zinc-500 font-medium block">Upload Destination</span>
                    <div className="flex items-center space-x-1.5 text-zinc-200 font-semibold truncate">
                      <Folder className="w-3 h-3 text-purple-400 shrink-0" />
                      <span className="truncate text-xs">{targetFolderDisplay}</span>
                    </div>
                  </div>

                  <div className="bg-[#151520] border border-[#232332] rounded-2xl p-2.5 space-y-0.5">
                    <span className="text-[10px] text-zinc-500 font-medium block">Last Seen Active</span>
                    <span className="text-zinc-200 font-semibold text-xs block truncate">
                      {new Date(device.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>

                {/* Active Constraint Badges */}
                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span
                    className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg border font-medium ${
                      device.policy?.wifiOnly
                        ? 'bg-purple-950/40 text-purple-300 border-purple-800/40'
                        : 'bg-[#151520] text-zinc-400 border-[#222230]'
                    }`}
                  >
                    <Wifi className="w-3 h-3" />
                    <span>{device.policy?.wifiOnly ? 'Wi-Fi Only' : 'Wi-Fi & Cellular'}</span>
                  </span>

                  <span
                    className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg border font-medium ${
                      device.policy?.chargingOnly
                        ? 'bg-amber-950/40 text-amber-300 border-amber-800/40'
                        : 'bg-[#151520] text-zinc-400 border-[#222230]'
                    }`}
                  >
                    <BatteryCharging className="w-3 h-3" />
                    <span>{device.policy?.chargingOnly ? 'Charging Only' : 'Any Battery'}</span>
                  </span>

                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-[#151520] text-zinc-300 border border-[#222230] font-medium">
                    <ImageIcon className="w-3 h-3 text-purple-400" />
                    <span>
                      {[
                        device.policy?.syncPhotos !== false ? 'Photos' : null,
                        device.policy?.syncVideos !== false ? 'Videos' : null,
                      ].filter(Boolean).join(' & ') || 'Media Off'}
                    </span>
                  </span>
                </div>

                {/* Collapsible Policy & Destination Settings Panel */}
                {isSettingsExpanded && (
                  <div className="bg-[#14141e] border border-[#232332] rounded-2xl p-4 space-y-3.5 text-xs animate-in fade-in duration-150">
                    <div className="font-bold text-zinc-400 text-[10px] uppercase tracking-wider flex items-center space-x-1.5">
                      <Sliders className="w-3.5 h-3.5 text-purple-400" />
                      <span>Device Sync Policies</span>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center text-zinc-300 text-xs font-medium">
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
                        <span className="flex items-center text-zinc-300 text-xs font-medium">
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
                    </div>

                    {/* Destination Folder Selector */}
                    <div className="pt-2 border-t border-[#20202e] space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center text-zinc-300 font-medium text-xs">
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
                    </div>

                    {/* Media Type Filters */}
                    <div className="pt-2 border-t border-[#20202e] space-y-2">
                      <span className="text-[10px] text-zinc-500 font-medium block">Allowed Media Types</span>
                      <div className="grid grid-cols-4 gap-1.5">
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
                          title="Auto download paired device photos into phone Gallery"
                          className={`flex items-center justify-center space-x-1 py-1.5 px-2 rounded-xl text-[10px] font-bold border transition ${
                            device.policy?.autoDownloadToGallery
                              ? 'bg-purple-950/60 text-purple-300 border-purple-600/80 shadow-glow-purple'
                              : 'bg-zinc-900 text-zinc-600 border-zinc-800'
                          }`}
                        >
                          <Download className="w-3 h-3" />
                          <span>Inbound</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Card Action Footer: Clean, Minimal & Professional */}
                <div className="pt-2 border-t border-[#1a1a24] flex items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    {/* Primary Button: View Logs */}
                    <button
                      onClick={() => setViewingLogsDevice(device)}
                      className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-purple-950/50 hover:bg-purple-900/60 text-purple-300 border border-purple-500/40 hover:border-purple-500 transition shadow-sm active:scale-95"
                    >
                      <Activity className="w-3.5 h-3.5 text-purple-400" />
                      <span>View Logs</span>
                      {logCount > 0 && (
                        <span className="px-1.5 py-0.2 rounded-md bg-purple-900/80 text-purple-200 text-[10px] font-mono border border-purple-700/40">
                          {logCount}
                        </span>
                      )}
                    </button>

                    {/* Uploaded Docs Inspection Button */}
                    <button
                      onClick={() => handleOpenUploads(device)}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white bg-[#151520] hover:bg-[#1e1e2c] border border-[#232332] transition active:scale-95"
                      title="View all files uploaded by this device"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Files</span>
                    </button>
                  </div>

                  {/* Right Actions: Settings Toggle, Reset Key, Revoke */}
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => toggleSettings(device._id)}
                      className={`p-2 rounded-xl text-xs font-semibold border transition active:scale-95 ${
                        isSettingsExpanded
                          ? 'bg-purple-900/40 text-purple-300 border-purple-500/50'
                          : 'bg-[#151520] text-zinc-400 hover:text-white border-[#232332]'
                      }`}
                      title={isSettingsExpanded ? 'Hide Settings' : 'Configure Policy & Destination'}
                    >
                      {isSettingsExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-purple-400" />
                      ) : (
                        <Settings className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <button
                      onClick={() => handleResetKey(device._id, device.deviceName)}
                      className="p-2 rounded-xl text-xs text-blue-400/80 hover:text-blue-300 bg-[#151520] hover:bg-[#1e1e2c] border border-[#232332] transition active:scale-95"
                      title="Reset Pairing Key"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleRevoke(device._id, device.deviceName)}
                      className="p-2 rounded-xl text-xs text-red-400/80 hover:text-red-300 bg-[#151520] hover:bg-red-950/20 border border-[#232332] hover:border-red-900/40 transition active:scale-95"
                      title="Revoke Device Access"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Uploaded Docs Inspection Modal */}
      {inspectDevice && createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#13131a] border border-[#27273a] rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden font-sans">
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

      {/* Cloud-Grade Structured Device Log Viewer Modal */}
      {viewingLogsDevice && createPortal(
        <DeviceLogViewerModal
          device={viewingLogsDevice}
          onClose={() => {
            setViewingLogsDevice(null);
            if (onCloseLogModal) onCloseLogModal();
          }}
          onClearLogs={handleClearLogs}
          isClearingLogs={isClearingLogs}
        />,
        document.body
      )}
    </div>
  );
};
