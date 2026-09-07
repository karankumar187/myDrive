import React, { useState, useEffect } from 'react';
import { StorageSummary, StorageAccount } from '../types.js';
import {
  HardDrive,
  Plus,
  RefreshCw,
  AlertCircle,
  ShieldCheck,
  Database,
  LayoutGrid,
  List,
  Search,
  MoreVertical,
  Trash2,
  ExternalLink,
  X,
} from 'lucide-react';
import { api } from '../services/api.js';
import { formatBytes } from '../utils/format.js';

interface Props {
  summary: StorageSummary | null;
  onRefresh: () => void;
}

/**
 * Google Account Avatar component.
 * Displays user's Google profile picture if available, or renders
 * a vibrant Google-style circular avatar with the user's initial.
 */
const AccountAvatar: React.FC<{ name: string; email: string; avatarUrl?: string }> = ({
  name,
  email,
  avatarUrl,
}) => {
  const [imgError, setImgError] = useState(false);
  const initial = (name || email || 'G').charAt(0).toUpperCase();

  const gradients = [
    'from-purple-600 to-indigo-600',
    'from-violet-600 to-purple-800',
    'from-fuchsia-600 to-purple-600',
    'from-purple-500 to-pink-600',
    'from-indigo-600 to-violet-700',
  ];
  const charCode = (name || email).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const gradient = gradients[Math.abs(charCode) % gradients.length];

  const src =
    avatarUrl ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(
      name || email
    )}&background=7c3aed&color=fff&bold=true&size=96`;

  if (!imgError) {
    return (
      <img
        src={src}
        alt={name || email}
        onError={() => setImgError(true)}
        className="w-9 h-9 rounded-full object-cover ring-2 ring-purple-500/30 shadow-md flex-shrink-0"
      />
    );
  }

  return (
    <div
      className={`w-9 h-9 rounded-full bg-gradient-to-tr ${gradient} flex items-center justify-center text-white font-bold text-xs shadow-md ring-2 ring-purple-500/30 flex-shrink-0`}
    >
      {initial}
    </div>
  );
};

export const StorageSummaryView: React.FC<Props> = ({ summary, onRefresh }) => {
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  // Close open dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (activeMenuId && !(e.target as Element).closest('.account-menu-container')) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeMenuId]);

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
      setSyncingAccountId(id);
      await api.syncAccountQuota(id);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSyncingAccountId(null);
      setActiveMenuId(null);
    }
  };

  const handleSyncAll = async () => {
    if (!summary?.accounts?.length) return;
    try {
      setIsSyncingAll(true);
      await Promise.allSettled(summary.accounts.map((acc) => api.syncAccountQuota(acc.id)));
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleRemoveAccount = async (id: string, email: string) => {
    if (!confirm(`Are you sure you want to unlink ${email}?`)) return;
    try {
      await api.removeAccount(id);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActiveMenuId(null);
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

  // Filter accounts by search query
  const filteredAccounts = (summary.accounts || []).filter((acc) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      acc.email.toLowerCase().includes(q) ||
      (acc.name && acc.name.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6 pb-6">
      {/* ========================================================
          TOP BENTO GRID
          ======================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Main Pooled Storage Card */}
        <div className="lg:col-span-8 bg-[#111018]/95 border border-purple-900/30 rounded-3xl p-6 sm:p-7 relative overflow-hidden shadow-2xl flex flex-col justify-between">
          {/* Ambient Purple Background Glow */}
          <div className="absolute -top-24 -right-24 w-80 h-80 bg-purple-600/15 rounded-full blur-3xl pointer-events-none" />

          <div>
            {/* Header: Label + Connect Drive Button */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                POOLED STORAGE
              </span>
              <button
                onClick={handleConnectDrive}
                disabled={loading}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-purple-600 to-violet-500 hover:from-purple-500 hover:to-violet-400 rounded-xl shadow-[0_0_15px_rgba(168,85,247,0.4)] transition active:scale-95 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Connect Drive</span>
              </button>
            </div>

            {/* Headline Metric */}
            <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {formatBytes(summary.usedCapacityBytes)}{' '}
              <span className="text-zinc-500 font-normal text-lg sm:text-xl">of</span>{' '}
              {formatBytes(summary.totalCapacityBytes)} Used
            </div>

            {/* Modern Glowing Purple Progress Bar */}
            <div className="mt-4 mb-2">
              <div className="w-full h-3.5 bg-[#191724] border border-[#2b273d] rounded-full p-0.5 overflow-hidden flex items-center relative">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-purple-600 via-purple-500 to-violet-400 shadow-[0_0_14px_rgba(168,85,247,0.6)] transition-all duration-700"
                  style={{ width: `${Math.max(2, summary.percentUsed)}%` }}
                />
                <span className="text-[10px] font-bold text-zinc-300 ml-auto pr-2 absolute right-0">
                  {summary.percentUsed}%
                </span>
              </div>
            </div>
          </div>

          {/* Sub-stats Row */}
          <div className="grid grid-cols-3 gap-3 pt-4 border-t border-[#1f1c2d] mt-4 text-xs">
            <div>
              <p className="text-[11px] text-zinc-400">Storage Pool:</p>
              <p className="text-sm sm:text-base font-bold text-white tracking-tight">
                {formatBytes(summary.totalCapacityBytes)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-zinc-400">Active Drives:</p>
              <p className="text-sm sm:text-base font-bold text-white tracking-tight">
                {summary.healthyAccounts || summary.totalAccounts}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-zinc-400">Available Buffer:</p>
              <p className="text-sm sm:text-base font-bold text-emerald-400 tracking-tight">
                {formatBytes(summary.availableCapacityBytes)}
              </p>
            </div>
          </div>
        </div>

        {/* Right Side 2x2 Bento Metric Tiles */}
        <div className="lg:col-span-4 grid grid-cols-2 gap-3.5">
          {/* Tile 1: Available Space */}
          <div className="bg-[#111018]/90 border border-[#242233] hover:border-purple-500/30 rounded-2xl p-4 flex flex-col justify-between transition shadow-lg">
            <p className="text-[11px] font-medium text-zinc-400">Available Space</p>
            <div className="my-2">
              <p className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
                {formatBytes(summary.availableCapacityBytes)}
              </p>
            </div>
            <p className="text-[10px] text-zinc-500">Unused capacity</p>
          </div>

          {/* Tile 2: Connected Drives */}
          <div className="bg-[#111018]/90 border border-[#242233] hover:border-purple-500/30 rounded-2xl p-4 flex flex-col justify-between transition shadow-lg">
            <p className="text-[11px] font-medium text-zinc-400">Connected Drives</p>
            <div className="my-2">
              <p className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
                ({summary.totalAccounts})
              </p>
            </div>
            <p className="text-[10px] text-emerald-400 flex items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1 shadow-[0_0_6px_#34d399]" />
              All Online
            </p>
          </div>

          {/* Tile 3: Safety Buffer */}
          <div className="bg-[#111018]/90 border border-[#242233] hover:border-purple-500/30 rounded-2xl p-4 flex flex-col justify-between transition shadow-lg">
            <p className="text-[11px] font-medium text-zinc-400">Safety Buffer</p>
            <div className="my-2">
              <p className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
                500 MB
              </p>
            </div>
            <p className="text-[10px] text-purple-400">Per drive quota lock</p>
          </div>

          {/* Tile 4: Security Status */}
          <div className="bg-[#111018]/90 border border-[#242233] hover:border-purple-500/30 rounded-2xl p-4 flex flex-col justify-between transition shadow-lg">
            <p className="text-[11px] font-medium text-zinc-400">Security Status</p>
            <div className="my-2">
              <p className="text-lg sm:text-xl font-extrabold text-white tracking-tight">
                Healthy
              </p>
            </div>
            <p className="text-[10px] text-zinc-500 flex items-center">
              <ShieldCheck className="w-3 h-3 mr-1 text-emerald-400" />
              AES-256 Enabled
            </p>
          </div>
        </div>
      </div>

      {/* ========================================================
          CONNECTED ACCOUNTS TOOLBAR
          ======================================================== */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
          {/* Left Title */}
          <div className="flex items-center space-x-2">
            <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
              Connected Accounts <span className="text-zinc-500 text-sm font-normal">({filteredAccounts.length})</span>
            </h3>
            <button
              onClick={handleSyncAll}
              disabled={isSyncingAll}
              title="Sync all quotas"
              className="text-zinc-400 hover:text-purple-400 p-1 rounded-lg transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAll ? 'animate-spin text-purple-400' : ''}`} />
            </button>
          </div>

          {/* Right Controls: View Switcher & Search */}
          <div className="flex items-center space-x-2.5">
            {/* View Mode Switcher */}
            <div className="flex items-center bg-[#16151f] border border-[#272435] rounded-xl p-0.5">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-lg transition ${
                  viewMode === 'grid'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
                title="Grid View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-lg transition ${
                  viewMode === 'list'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
                title="List View"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Filter Search Input */}
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 pointer-events-none" />
              <input
                type="text"
                placeholder="Filter accounts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-44 sm:w-56 bg-[#14131c] border border-[#272435] focus:border-purple-500/60 rounded-xl pl-8 pr-7 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none transition shadow-inner"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 text-zinc-400 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Empty State */}
        {filteredAccounts.length === 0 ? (
          <div className="bg-[#111018] border border-[#242233] rounded-3xl p-10 text-center space-y-2">
            <Database className="w-10 h-10 text-zinc-600 mx-auto" />
            <p className="text-sm font-semibold text-zinc-200">
              {searchQuery ? 'No accounts match your filter' : 'No Google Drive accounts connected yet'}
            </p>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto">
              {searchQuery
                ? 'Try searching with a different email or account name.'
                : 'Click "+ Connect Drive" to pool storage accounts into a unified cloud library.'}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          /* ========================================================
             GRID VIEW (Cards matching mockup with Google Avatars)
             ======================================================== */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAccounts.map((acc) => (
              <div
                key={acc.id}
                className="bg-[#111018]/90 border border-[#242233] hover:border-purple-500/40 rounded-2xl p-4 sm:p-5 shadow-lg space-y-3 transition duration-200 group relative"
              >
                {/* Top Row: Avatar, Email, Status, 3-dot kebab menu */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 min-w-0">
                    {/* Google Account Avatar */}
                    <AccountAvatar name={acc.name} email={acc.email} />

                    <div className="min-w-0">
                      <p className="font-semibold text-white text-xs sm:text-sm truncate group-hover:text-purple-300 transition max-w-[150px] sm:max-w-[170px]">
                        {acc.email}
                      </p>
                      {acc.name && acc.name !== acc.email && (
                        <p className="text-[11px] text-zinc-500 truncate max-w-[150px] sm:max-w-[170px]">
                          {acc.name}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Status Badge & 3-Dot Action Button */}
                  <div className="flex items-center space-x-1.5 flex-shrink-0">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        acc.status === 'healthy'
                          ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
                          : 'bg-amber-950/40 text-amber-400 border-amber-800/50'
                      }`}
                    >
                      {acc.status === 'healthy' ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1 shadow-[0_0_6px_#34d399]" />
                          Active
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3 h-3 mr-1" />
                          {acc.status}
                        </>
                      )}
                    </span>

                    {/* 3-Dot Kebab Menu */}
                    <div className="relative account-menu-container">
                      <button
                        onClick={() => setActiveMenuId(activeMenuId === acc.id ? null : acc.id)}
                        className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-[#1f1d2b] transition"
                        title="Account options"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {/* Dropdown Floating Menu */}
                      {activeMenuId === acc.id && (
                        <div className="absolute right-0 mt-1 w-44 bg-[#15141f] border border-[#2b273d] rounded-xl p-1 shadow-2xl z-30 text-xs space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                          <button
                            onClick={() => handleSyncAccount(acc.id)}
                            disabled={syncingAccountId === acc.id}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-purple-600/20 flex items-center space-x-2 transition"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 text-purple-400 ${
                                syncingAccountId === acc.id ? 'animate-spin' : ''
                              }`}
                            />
                            <span>Sync Quota</span>
                          </button>

                          <a
                            href="https://drive.google.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full text-left px-2.5 py-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-purple-600/20 flex items-center space-x-2 transition"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                            <span>Open Drive</span>
                          </a>

                          <div className="border-t border-[#252233] my-1" />

                          <button
                            onClick={() => handleRemoveAccount(acc.id, acc.email)}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-950/40 flex items-center space-x-2 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Unlink Account</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Middle: Sleek glowing purple progress bar */}
                <div className="pt-2">
                  <div className="w-full h-1.5 bg-[#1a1826] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-600 to-violet-400 rounded-full shadow-[0_0_8px_rgba(168,85,247,0.5)] transition-all duration-500"
                      style={{ width: `${Math.max(2, acc.percentUsed)}%` }}
                    />
                  </div>
                </div>

                {/* Bottom Row: Used / Total */}
                <div className="flex justify-between items-center text-[11px] text-zinc-400 pt-0.5">
                  <span className="text-[10px] text-zinc-500 font-medium">
                    {acc.percentUsed}% full
                  </span>
                  <span className="font-semibold text-zinc-300">
                    {formatBytes(acc.usedBytes)} / {formatBytes(acc.totalBytes)} Used
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ========================================================
             LIST VIEW (Compact rows for high density)
             ======================================================== */
          <div className="bg-[#111018]/90 border border-[#242233] rounded-2xl overflow-hidden divide-y divide-[#1f1d2b] shadow-xl">
            {filteredAccounts.map((acc) => (
              <div
                key={acc.id}
                className="p-3.5 sm:px-5 flex items-center justify-between hover:bg-[#161521] transition group"
              >
                {/* Left: Avatar + Name/Email */}
                <div className="flex items-center space-x-3 min-w-0 w-1/3">
                  <AccountAvatar name={acc.name} email={acc.email} />
                  <div className="min-w-0">
                    <p className="font-semibold text-white text-xs truncate group-hover:text-purple-300 transition">
                      {acc.email}
                    </p>
                    {acc.name && acc.name !== acc.email && (
                      <p className="text-[10px] text-zinc-500 truncate">{acc.name}</p>
                    )}
                  </div>
                </div>

                {/* Status */}
                <div className="hidden sm:flex items-center">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                      acc.status === 'healthy'
                        ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                        : 'bg-amber-950/40 text-amber-400 border-amber-800/50'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1 shadow-[0_0_6px_#34d399]" />
                    Active
                  </span>
                </div>

                {/* Middle: Progress Bar & Used */}
                <div className="w-1/3 max-w-xs space-y-1">
                  <div className="w-full h-1.5 bg-[#1a1826] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-600 to-violet-400 rounded-full shadow-[0_0_8px_rgba(168,85,247,0.5)] transition-all duration-500"
                      style={{ width: `${Math.max(2, acc.percentUsed)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-400">
                    <span>{acc.percentUsed}%</span>
                    <span>
                      {formatBytes(acc.usedBytes)} / {formatBytes(acc.totalBytes)}
                    </span>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleSyncAccount(acc.id)}
                    disabled={syncingAccountId === acc.id}
                    title="Sync Quota"
                    className="p-1.5 text-zinc-400 hover:text-purple-400 hover:bg-[#201d2d] rounded-lg transition"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${syncingAccountId === acc.id ? 'animate-spin text-purple-400' : ''}`}
                    />
                  </button>
                  <button
                    onClick={() => handleRemoveAccount(acc.id, acc.email)}
                    title="Unlink Account"
                    className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
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
