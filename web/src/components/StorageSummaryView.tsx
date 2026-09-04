import React, { useState } from 'react';
import { StorageSummary } from '../types.js';
import { HardDrive, Plus, RefreshCw, AlertCircle, CheckCircle, ShieldCheck, Database, Layers } from 'lucide-react';
import { api } from '../services/api.js';

interface Props {
  summary: StorageSummary | null;
  onRefresh: () => void;
}

export const StorageSummaryView: React.FC<Props> = ({ summary, onRefresh }) => {
  const [loading, setLoading] = useState(false);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 GB';
    const gb = bytes / (1024 * 1024 * 1024);
    return gb.toFixed(1) + ' GB';
  };

  const handleConnectDrive = async () => {
    try {
      setLoading(true);
      const { url } = await api.getConnectUrl();
      window.location.href = url;
    } catch (err: any) {
      alert(err.message || 'Failed to start Google Drive authorization');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncAccount = async (id: string) => {
    try {
      await api.syncAccountQuota(id);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRemoveAccount = async (id: string, email: string) => {
    if (!confirm(`Are you sure you want to unlink ${email}?`)) return;
    try {
      await api.removeAccount(id);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (!summary) {
    return (
      <div className="p-16 text-center text-zinc-500 flex flex-col items-center justify-center space-y-3">
        <RefreshCw className="w-6 h-6 animate-spin text-purple-500" />
        <span className="text-xs">Aggregating storage pool metrics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overall Pooled Meter Card */}
      <div className="bg-[#111114] border border-[#222227] rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden group hover:border-purple-500/30 transition duration-300">
        {/* Subtle ambient corner glow */}
        <div className="absolute -right-20 -top-20 w-64 h-64 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center space-x-3.5">
            <div className="p-3 bg-purple-950/40 text-purple-400 border border-purple-800/40 rounded-2xl shadow-glow-purple">
              <HardDrive className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">Pooled Cloud Storage</h2>
              <p className="text-xs text-zinc-400">
                {summary.totalAccounts} connected Google Drive accounts combined into one library
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleConnectDrive}
              disabled={loading}
              className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-violet-500 hover:from-purple-500 hover:to-violet-400 rounded-full shadow-glow-purple transition active:scale-95 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Connect Drive</span>
            </button>
          </div>
        </div>

        {/* Big Glowing Progress Bar */}
        <div className="space-y-2.5">
          <div className="flex justify-between text-xs">
            <span className="font-bold text-white text-sm tracking-tight">
              {formatBytes(summary.usedCapacityBytes)} <span className="text-zinc-500 font-normal">used of</span>{' '}
              {formatBytes(summary.totalCapacityBytes)}
            </span>
            <span className="font-semibold text-purple-400">{summary.percentUsed}% utilized</span>
          </div>

          <div className="w-full h-3.5 bg-[#18181f] border border-[#25252f] rounded-full overflow-hidden p-0.5">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                summary.percentUsed > 85
                  ? 'bg-amber-500 shadow-[0_0_12px_#f59e0b]'
                  : 'bg-gradient-to-r from-purple-600 to-violet-400 shadow-glow-purple'
              }`}
              style={{ width: `${Math.max(2, summary.percentUsed)}%` }}
            />
          </div>

          <div className="flex justify-between text-[11px] text-zinc-500 font-medium pt-1">
            <span>Available in pool: <strong className="text-zinc-300">{formatBytes(summary.availableCapacityBytes)}</strong></span>
            <span className="flex items-center space-x-1 text-emerald-400">
              <ShieldCheck className="w-3 h-3 inline" />
              <span>500 MB safety buffer active</span>
            </span>
          </div>
        </div>
      </div>

      {/* Account by Account Breakdown */}
      <div className="space-y-4">
        <div className="flex justify-between items-center px-1">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Connected Accounts</h3>
            <span className="text-xs text-zinc-500">({summary.accounts.length})</span>
          </div>
          <button
            onClick={onRefresh}
            className="flex items-center space-x-1.5 text-xs text-zinc-400 hover:text-white transition"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Sync Quotas</span>
          </button>
        </div>

        {summary.accounts.length === 0 ? (
          <div className="bg-[#111114] border border-[#222227] rounded-3xl p-10 text-center space-y-2">
            <Database className="w-10 h-10 text-zinc-600 mx-auto" />
            <p className="text-sm font-semibold text-zinc-200">No Google Drive accounts connected yet</p>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto">
              Click &quot;Connect Drive&quot; to pool storage accounts into a unified cloud library.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {summary.accounts.map((acc) => (
              <div
                key={acc.id}
                className="bg-[#111114] border border-[#222227] hover:border-purple-500/40 rounded-2xl p-5 shadow-lg space-y-4 transition duration-300 group"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-0.5">
                    <h4 className="font-bold text-white text-sm group-hover:text-purple-300 transition">
                      {acc.name}
                    </h4>
                    <p className="text-xs text-zinc-400 truncate max-w-[190px]">{acc.email}</p>
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                      acc.status === 'healthy'
                        ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                        : 'bg-amber-950/40 text-amber-400 border-amber-800/50'
                    }`}
                  >
                    {acc.status === 'healthy' ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 shadow-[0_0_6px_#34d399]" />
                        Active
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-3 h-3 mr-1" />
                        {acc.status}
                      </>
                    )}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="space-y-1.5">
                  <div className="w-full h-2 bg-[#191921] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-600 to-violet-500 rounded-full"
                      style={{ width: `${Math.max(3, acc.percentUsed)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-zinc-500 font-medium">
                    <span>{formatBytes(acc.usedBytes)} used</span>
                    <span>{formatBytes(acc.totalBytes)}</span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center justify-between pt-2 border-t border-[#1a1a20] text-xs">
                  <button
                    onClick={() => handleSyncAccount(acc.id)}
                    className="text-zinc-400 hover:text-purple-400 font-semibold transition"
                  >
                    Refresh Quota
                  </button>
                  <button
                    onClick={() => handleRemoveAccount(acc.id, acc.email)}
                    className="text-red-400/80 hover:text-red-400 font-semibold transition"
                  >
                    Unlink
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
