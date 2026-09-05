import React, { useState } from 'react';
import { DeviceItem, FileItem } from '../types.js';
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

  // Sync external log modal trigger
  React.useEffect(() => {
    if (selectedLogDevice) {
      setViewingLogsDevice(selectedLogDevice);
    }
  }, [selectedLogDevice]);

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
                  <div className="space-y-0.5">
                    <h3 className="font-bold text-white text-sm">{device.deviceName}</h3>
                    <p className="text-[11px] text-zinc-500">
                      ID: <code className="text-zinc-400">{device.deviceId}</code> • Last seen:{' '}
                      {new Date(device.lastSeenAt).toLocaleTimeString()}
                    </p>
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

              {/* Live Sync Activity Pill if Active */}
              {device.currentSyncActivity && (
                <div className="flex items-center space-x-2 text-xs text-purple-300 font-medium bg-purple-950/30 px-3 py-1.5 rounded-xl border border-purple-800/40 shadow-sm">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-400 flex-shrink-0" />
                  <span className="truncate">{device.currentSyncActivity}</span>
                </div>
              )}

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
                </div>

                <button
                  onClick={() => handleRevoke(device._id, device.deviceName)}
                  className="flex items-center space-x-1.5 text-xs text-red-400/80 hover:text-red-400 font-semibold transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Revoke</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Uploaded Docs Inspection Modal */}
      {inspectDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
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
        </div>
      )}

      {/* Live Sync Activity & Logs Modal */}
      {viewingLogsDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
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

              {/* Live Logs List */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider px-1">
                  Device Sync Log History
                </div>
                {(!viewingLogsDevice.syncLogs || viewingLogsDevice.syncLogs.length === 0) ? (
                  <div className="p-8 text-center text-zinc-500 bg-[#14141d] rounded-2xl border border-[#22222e]">
                    <Activity className="w-8 h-8 mx-auto text-zinc-600 mb-2" />
                    <p className="text-xs font-semibold text-zinc-400">No sync logs recorded yet</p>
                    <p className="text-[11px] text-zinc-600 mt-0.5">Logs will stream here in real time as the device syncs.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5 font-mono text-xs max-h-64 overflow-y-auto pr-1">
                    {[...viewingLogsDevice.syncLogs].reverse().map((entry, i) => (
                      <div
                        key={i}
                        className="bg-[#14141e] border border-[#232332] p-2.5 rounded-xl flex items-start space-x-2.5 text-zinc-300"
                      >
                        <span className="text-purple-400 text-[10px] flex-shrink-0 mt-0.5">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="text-xs text-zinc-200 break-words">{entry.message}</span>
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
        </div>
      )}
    </div>
  );
};
