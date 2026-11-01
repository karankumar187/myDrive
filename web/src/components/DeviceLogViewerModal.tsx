import React, { useState, useMemo } from 'react';
import { DeviceItem, SyncLogEntry } from '../types.js';
import {
  X,
  Search,
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Zap,
  RefreshCw,
  Copy,
  Check,
  Trash2,
  Download,
  Filter,
  BarChart3,
  Calendar,
  Layers,
} from 'lucide-react';
import { formatBytes } from '../utils/format.js';

interface Props {
  device: DeviceItem;
  onClose: () => void;
  onClearLogs: (deviceDocId: string) => Promise<void>;
  isClearingLogs: boolean;
}

type PeriodFilter = 'all' | '1h' | '6h' | '24h' | '7d';
type SeverityFilter = 'all' | 'info' | 'processing' | 'uploaded' | 'duplicate' | 'error';

export const DeviceLogViewerModal: React.FC<Props> = ({
  device,
  onClose,
  onClearLogs,
  isClearingLogs,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [expandedRowIds, setExpandedRowIds] = useState<Set<number>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [hoveredBucket, setHoveredBucket] = useState<{
    timeLabel: string;
    count: number;
    breakdown?: Record<string, number>;
  } | null>(null);

  const logs = useMemo(() => {
    return device.syncLogs || [];
  }, [device.syncLogs]);

  // Infer severity level if not explicitly provided
  const getLogSeverity = (entry: SyncLogEntry): 'info' | 'processing' | 'uploaded' | 'duplicate' | 'error' => {
    if (entry.level) {
      if (entry.level === 'revived') return 'uploaded';
      return entry.level;
    }
    const lower = (entry.message || '').toLowerCase();
    if (lower.includes('error') || lower.includes('failed') || lower.includes('interrupted')) return 'error';
    if (lower.includes('⚡') || lower.includes('duplicate') || lower.includes('skipped') || lower.includes('linked')) return 'duplicate';
    if (lower.includes('✓') || lower.includes('backed up') || lower.includes('uploaded') || lower.includes('saved')) return 'uploaded';
    if (lower.includes('processing') || lower.includes('checking') || lower.includes('streaming')) return 'processing';
    return 'info';
  };

  // Filter logs based on period, severity, and search query
  const filteredLogs = useMemo(() => {
    const now = Date.now();
    return logs.filter((log, idx) => {
      const logTime = new Date(log.timestamp).getTime();

      // Period filter
      if (periodFilter === '1h' && now - logTime > 60 * 60 * 1000) return false;
      if (periodFilter === '6h' && now - logTime > 6 * 60 * 60 * 1000) return false;
      if (periodFilter === '24h' && now - logTime > 24 * 60 * 60 * 1000) return false;
      if (periodFilter === '7d' && now - logTime > 7 * 24 * 60 * 60 * 1000) return false;

      // Severity filter
      const severity = getLogSeverity(log);
      if (severityFilter !== 'all' && severity !== severityFilter) return false;

      // Text search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const inMsg = (log.message || '').toLowerCase().includes(query);
        const inName = (log.filename || '').toLowerCase().includes(query);
        const inDetails = (log.details || '').toLowerCase().includes(query);
        if (!inMsg && !inName && !inDetails) return false;
      }

      return true;
    });
  }, [logs, periodFilter, severityFilter, searchQuery]);

  // Compute Timeline Histogram buckets (28 bars across current log range or time span)
  const histogramData = useMemo(() => {
    if (filteredLogs.length === 0) return { buckets: [], maxCount: 0, timeLabels: [] };

    const timestamps = filteredLogs.map((l) => new Date(l.timestamp).getTime());
    let minTime = Math.min(...timestamps);
    let maxTime = Math.max(...timestamps);

    // If all events happen within a few seconds, create at least a 10-minute window
    if (maxTime - minTime < 10 * 60 * 1000) {
      minTime = maxTime - 10 * 60 * 1000;
    }

    const numBuckets = 32;
    const bucketDuration = (maxTime - minTime) / numBuckets;
    const buckets: Array<{
      index: number;
      startTime: number;
      endTime: number;
      timeLabel: string;
      count: number;
      breakdown: Record<string, number>;
    }> = [];

    for (let i = 0; i < numBuckets; i++) {
      const bStart = minTime + i * bucketDuration;
      const bEnd = bStart + bucketDuration;
      buckets.push({
        index: i,
        startTime: bStart,
        endTime: bEnd,
        timeLabel: new Date(bStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        count: 0,
        breakdown: { uploaded: 0, duplicate: 0, error: 0, info: 0, processing: 0 },
      });
    }

    // Distribute filtered logs into buckets
    filteredLogs.forEach((log) => {
      const t = new Date(log.timestamp).getTime();
      let bucketIdx = Math.floor((t - minTime) / bucketDuration);
      if (bucketIdx < 0) bucketIdx = 0;
      if (bucketIdx >= numBuckets) bucketIdx = numBuckets - 1;

      buckets[bucketIdx].count++;
      const sev = getLogSeverity(log);
      buckets[bucketIdx].breakdown[sev] = (buckets[bucketIdx].breakdown[sev] || 0) + 1;
    });

    const maxCount = Math.max(...buckets.map((b) => b.count), 1);

    // Pick 5-6 evenly spaced time labels for the x-axis
    const timeLabels = [
      new Date(minTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      new Date(minTime + 0.25 * (maxTime - minTime)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      new Date(minTime + 0.5 * (maxTime - minTime)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      new Date(minTime + 0.75 * (maxTime - minTime)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      new Date(maxTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    ];

    return { buckets, maxCount, timeLabels };
  }, [filteredLogs]);

  const toggleRow = (index: number) => {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const cleanMessage = (msg: string) => {
    return (msg || '').replace(/^[\s\u200B]*[✓⚡🔄⚠️☁️📸]\s*/, '').trim();
  };

  const formatTimestamp = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString([], {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-150">
      <div className="bg-[#0b0b10] border border-[#222232] rounded-3xl w-full max-w-5xl h-[92vh] max-h-[900px] flex flex-col shadow-2xl overflow-hidden font-sans">
        {/* Top Header Bar */}
        <div className="px-6 py-4 border-b border-[#1c1c28] bg-[#0e0e16] flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-purple-950/50 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2.5">
                <h3 className="font-bold text-white text-base truncate tracking-tight">
                  {device.deviceName} Logs
                </h3>
                {(() => {
                  const isActivelySyncing = device.status === 'syncing' && (Date.now() - (device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0) < 45000);
                  const effectiveStatus = isActivelySyncing ? 'syncing' : (device.status === 'offline' ? 'offline' : 'online');
                  return (
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
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
              {(() => {
                const isActivelySyncing = device.status === 'syncing' && (Date.now() - (device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0) < 45000);
                const displayActivity = isActivelySyncing ? device.currentSyncActivity : null;
                return (
                  <p className="text-xs text-zinc-400 font-mono flex items-center space-x-2 mt-0.5">
                    <span>ID: {device.deviceId}</span>
                    <span className="text-zinc-600">•</span>
                    <span>Type: {device.deviceType}</span>
                    {displayActivity && (
                      <>
                        <span className="text-zinc-600">•</span>
                        <span className="text-purple-300 truncate max-w-[220px]">
                          {displayActivity}
                        </span>
                      </>
                    )}
                  </p>
                );
              })()}
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {logs.length > 0 && (
              <>
                <button
                  onClick={() => {
                    const content = filteredLogs
                      .map((l) => `[${formatTimestamp(l.timestamp)}] [${getLogSeverity(l).toUpperCase()}] ${l.filename ? l.filename + ' - ' : ''}${l.message}${l.details ? ' (' + l.details + ')' : ''}`)
                      .join('\n');
                    handleCopyText(content, 'copy_all');
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white bg-[#161622] hover:bg-[#1f1f2e] border border-[#272738] rounded-xl transition"
                  title="Copy filtered logs"
                >
                  {copiedKey === 'copy_all' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                  <span>{copiedKey === 'copy_all' ? 'Copied' : 'Copy'}</span>
                </button>

                <button
                  onClick={() => onClearLogs(device._id)}
                  disabled={isClearingLogs}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-red-400 hover:text-red-300 bg-red-950/20 hover:bg-red-950/40 border border-red-900/40 rounded-xl transition disabled:opacity-50"
                  title="Clear all logs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              </>
            )}

            <button
              onClick={onClose}
              className="p-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-800/60 transition"
              title="Close log viewer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Query & Filter Bar (Matching cloud logging console) */}
        <div className="px-6 py-3.5 bg-[#0f0f17] border-b border-[#1c1c28] space-y-3">
          {/* Main Query Bar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search logs by message, filename, status, or keyword..."
                className="w-full pl-10 pr-9 py-2 bg-[#141420] border border-[#262638] focus:border-purple-500 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none transition font-mono shadow-inner"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              onClick={() => {}}
              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-purple-950/30 transition active:scale-95 shrink-0"
            >
              Run Query
            </button>
          </div>

          {/* Filter Dropdowns and Count Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              {/* Period Dropdown */}
              <div className="flex items-center space-x-1.5 bg-[#141420] border border-[#262638] rounded-xl px-2.5 py-1 text-zinc-300">
                <Calendar className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-zinc-500 text-[11px]">Period:</span>
                <select
                  value={periodFilter}
                  onChange={(e) => setPeriodFilter(e.target.value as PeriodFilter)}
                  className="bg-transparent text-white text-xs font-medium focus:outline-none cursor-pointer"
                >
                  <option value="all" className="bg-[#141420]">All time</option>
                  <option value="1h" className="bg-[#141420]">Last 1 hour</option>
                  <option value="6h" className="bg-[#141420]">Last 6 hours</option>
                  <option value="24h" className="bg-[#141420]">Last 24 hours</option>
                  <option value="7d" className="bg-[#141420]">Last 7 days</option>
                </select>
              </div>

              {/* Severity Dropdown */}
              <div className="flex items-center space-x-1.5 bg-[#141420] border border-[#262638] rounded-xl px-2.5 py-1 text-zinc-300">
                <Filter className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-zinc-500 text-[11px]">Severity:</span>
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
                  className="bg-transparent text-white text-xs font-medium focus:outline-none cursor-pointer"
                >
                  <option value="all" className="bg-[#141420]">All Severities</option>
                  <option value="uploaded" className="bg-[#141420]">Success / Uploaded</option>
                  <option value="duplicate" className="bg-[#141420]">Warning / Duplicates</option>
                  <option value="error" className="bg-[#141420]">Error</option>
                  <option value="processing" className="bg-[#141420]">Processing</option>
                  <option value="info" className="bg-[#141420]">Info</option>
                </select>
              </div>
            </div>

            {/* Event Count */}
            <div className="text-xs text-zinc-400 font-mono">
              Displaying <span className="font-bold text-white">{filteredLogs.length}</span> event{filteredLogs.length === 1 ? '' : 's'}
              {filteredLogs.length !== logs.length && (
                <span className="text-zinc-500 ml-1"> (of {logs.length} total)</span>
              )}
            </div>
          </div>
        </div>

        {/* Middle Body: Event Details Histogram Chart & Log Table */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Activity Timeline / Histogram Section */}
          <div className="bg-[#101018] border border-[#1f1f2e] rounded-2xl p-4 space-y-2.5 relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-white tracking-tight">Event Timeline</span>
                <span className="text-[11px] text-zinc-500">
                  ({filteredLogs.length} entries over time)
                </span>
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">Live Activity Frequency</span>
            </div>

            {/* Histogram Bars Container */}
            <div className="relative pt-6 pb-2">
              {/* Tooltip on Hover */}
              {hoveredBucket && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-[#181824] border border-purple-500/40 rounded-lg px-2.5 py-1 text-[11px] text-white shadow-xl pointer-events-none z-10 flex items-center space-x-2">
                  <span className="font-bold text-purple-300">{hoveredBucket.timeLabel}</span>
                  <span className="text-zinc-500">•</span>
                  <span>{hoveredBucket.count} entr{hoveredBucket.count === 1 ? 'y' : 'ies'}</span>
                </div>
              )}

              {/* Bars Graphic */}
              <div className="h-16 flex items-end justify-between gap-1 w-full px-1">
                {histogramData.buckets.map((b) => {
                  const heightPercent = b.count > 0 ? Math.max(12, (b.count / histogramData.maxCount) * 100) : 4;
                  const hasError = (b.breakdown?.error || 0) > 0;
                  const hasDup = (b.breakdown?.duplicate || 0) > 0;
                  const barColor = b.count === 0
                    ? 'bg-[#1b1b26]'
                    : hasError
                    ? 'bg-red-500 hover:bg-red-400'
                    : hasDup
                    ? 'bg-purple-500 hover:bg-purple-400'
                    : 'bg-[#3b82f6] hover:bg-[#60a5fa]';

                  return (
                    <div
                      key={b.index}
                      onMouseEnter={() => setHoveredBucket({ timeLabel: b.timeLabel, count: b.count, breakdown: b.breakdown })}
                      onMouseLeave={() => setHoveredBucket(null)}
                      style={{ height: `${heightPercent}%` }}
                      className={`flex-1 min-w-[3px] max-w-[14px] rounded-t-sm transition-all duration-150 cursor-pointer ${barColor} ${
                        b.count > 0 ? 'hover:scale-y-110 shadow-sm' : ''
                      }`}
                    />
                  );
                })}
              </div>

              {/* Time Scale Labels */}
              <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono pt-2 border-t border-[#1a1a26] px-1">
                {histogramData.timeLabels.map((lbl, idx) => (
                  <span key={idx}>{lbl}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Structured Log Table */}
          <div className="bg-[#101018] border border-[#1f1f2e] rounded-2xl overflow-hidden shadow-lg">
            {/* Table Column Headers */}
            <div className="grid grid-cols-12 px-4 py-2.5 bg-[#141420] border-b border-[#222232] text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
              <div className="col-span-3 sm:col-span-2 flex items-center space-x-1.5">
                <span>SEVERITY</span>
              </div>
              <div className="col-span-4 sm:col-span-3">TIMESTAMP</div>
              <div className="col-span-5 sm:col-span-7">MESSAGE / EVENT</div>
            </div>

            {/* Table Rows */}
            {filteredLogs.length === 0 ? (
              <div className="p-12 text-center text-zinc-500 space-y-2">
                <Clock className="w-8 h-8 mx-auto text-zinc-600 mb-1" />
                <p className="text-sm font-semibold text-zinc-300">No events found matching your filter</p>
                <p className="text-xs text-zinc-500">
                  Try adjusting the query, period, or severity dropdowns above.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#181824] text-xs">
                {filteredLogs.map((entry, idx) => {
                  const isExpanded = expandedRowIds.has(idx);
                  const severity = getLogSeverity(entry);

                  return (
                    <div key={idx} className="group">
                      {/* Summary Row */}
                      <div
                        onClick={() => toggleRow(idx)}
                        className={`grid grid-cols-12 px-4 py-2.5 items-center cursor-pointer transition hover:bg-[#151522] ${
                          isExpanded ? 'bg-[#151522]' : ''
                        }`}
                      >
                        {/* Severity Column */}
                        <div className="col-span-3 sm:col-span-2 flex items-center space-x-2">
                          <button
                            type="button"
                            className="text-zinc-500 group-hover:text-zinc-300 transition shrink-0"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {severity === 'uploaded' && (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                              <span>Success</span>
                            </span>
                          )}
                          {severity === 'duplicate' && (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/60 text-amber-300 border border-amber-800/40">
                              <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                              <span>Warning</span>
                            </span>
                          )}
                          {severity === 'error' && (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-950/60 text-red-400 border border-red-800/40">
                              <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                              <span>Error</span>
                            </span>
                          )}
                          {severity === 'processing' && (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-950/60 text-purple-300 border border-purple-800/40 animate-pulse">
                              <RefreshCw className="w-3 h-3 animate-spin text-purple-400 shrink-0" />
                              <span>Syncing</span>
                            </span>
                          )}
                          {severity === 'info' && (
                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-950/50 text-sky-400 border border-sky-800/40">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                              <span>Info</span>
                            </span>
                          )}
                        </div>

                        {/* Timestamp Column */}
                        <div className="col-span-4 sm:col-span-3 text-zinc-400 font-mono text-[11px] truncate">
                          {formatTimestamp(entry.timestamp)}
                        </div>

                        {/* Message Column */}
                        <div className="col-span-5 sm:col-span-7 flex items-center justify-between gap-2 min-w-0 pr-2">
                          <span className="font-mono text-zinc-200 truncate text-[11px]">
                            {entry.filename ? (
                              <>
                                <span className="font-bold text-white">{entry.filename}</span>
                                <span className="text-zinc-500 mx-1.5">•</span>
                                <span className="text-zinc-300">{cleanMessage(entry.message)}</span>
                              </>
                            ) : (
                              cleanMessage(entry.message)
                            )}
                          </span>

                          {entry.sizeBytes ? (
                            <span className="px-1.5 py-0.5 rounded bg-[#1c1c28] text-zinc-400 font-mono text-[9px] border border-[#272738] shrink-0">
                              {formatBytes(entry.sizeBytes)}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {/* Expandable JSON / Details Inspector */}
                      {isExpanded && (
                        <div className="px-6 py-4 bg-[#0a0a0f] border-t border-b border-[#1f1f2e] space-y-3 font-mono text-xs animate-in fade-in duration-100">
                          <div className="flex items-center justify-between text-[11px] text-zinc-400">
                            <span className="font-bold text-purple-400 uppercase tracking-wider">
                              Event Inspector
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyText(JSON.stringify(entry, null, 2), `row_${idx}`);
                              }}
                              className="flex items-center space-x-1 text-[10px] text-zinc-400 hover:text-white px-2 py-0.5 rounded bg-[#161622] border border-[#252536] transition"
                            >
                              {copiedKey === `row_${idx}` ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span>{copiedKey === `row_${idx}` ? 'Copied JSON' : 'Copy JSON'}</span>
                            </button>
                          </div>

                          <div className="bg-[#12121c] p-3.5 rounded-xl border border-[#232334] text-zinc-300 text-[11px] leading-relaxed space-y-1.5 overflow-x-auto">
                            <div>
                              <span className="text-purple-400 font-semibold">"timestamp": </span>
                              <span className="text-emerald-300">"{entry.timestamp}"</span>
                            </div>
                            <div>
                              <span className="text-purple-400 font-semibold">"severity": </span>
                              <span className="text-amber-300">"{severity}"</span>
                            </div>
                            {entry.filename && (
                              <div>
                                <span className="text-purple-400 font-semibold">"filename": </span>
                                <span className="text-white font-bold">"{entry.filename}"</span>
                              </div>
                            )}
                            {entry.sizeBytes && (
                              <div>
                                <span className="text-purple-400 font-semibold">"sizeBytes": </span>
                                <span className="text-sky-300">{entry.sizeBytes}</span>
                                <span className="text-zinc-500"> ({formatBytes(entry.sizeBytes)})</span>
                              </div>
                            )}
                            <div>
                              <span className="text-purple-400 font-semibold">"message": </span>
                              <span className="text-zinc-200">"{cleanMessage(entry.message)}"</span>
                            </div>
                            {entry.details && (
                              <div>
                                <span className="text-purple-400 font-semibold">"details": </span>
                                <span className="text-zinc-300">"{entry.details}"</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal Bottom Footer */}
        <div className="px-6 py-3.5 border-t border-[#1c1c28] bg-[#0e0e16] flex items-center justify-between">
          <div className="text-xs text-zinc-500 font-mono">
            Device: <span className="text-zinc-300 font-semibold">{device.deviceName}</span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-white bg-[#1e1e2c] hover:bg-[#28283a] rounded-full transition active:scale-95"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
