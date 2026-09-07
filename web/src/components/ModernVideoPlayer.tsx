import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  PictureInPicture2,
  Download,
  Film,
  Loader2,
} from 'lucide-react';

interface ModernVideoPlayerProps {
  src: string;
  filename?: string;
  poster?: string;
  autoPlay?: boolean;
  className?: string;
  onDownload?: () => void;
  onError?: () => void;
}

const PLAYBACK_RATES = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');

  if (h > 0) {
    return `${h}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
}

export const ModernVideoPlayer: React.FC<ModernVideoPlayerProps> = ({
  src,
  filename,
  poster,
  autoPlay = true,
  className = '',
  onDownload,
  onError,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('drive_player_volume');
    return saved ? parseFloat(saved) : 1;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isDraggingScrubber, setIsDraggingScrubber] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const [bigPlayPulse, setBigPlayPulse] = useState(false);

  // Set initial volume
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
    }
  }, []);

  // Controls auto-hide logic
  const scheduleAutoHide = useCallback(() => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    setShowControls(true);

    if (isPlaying && !isDraggingScrubber && !showSpeedMenu) {
      hideControlsTimer.current = setTimeout(() => {
        setShowControls(false);
      }, 2500);
    }
  }, [isPlaying, isDraggingScrubber, showSpeedMenu]);

  const handleMouseMove = () => {
    scheduleAutoHide();
  };

  useEffect(() => {
    scheduleAutoHide();
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [isPlaying, showSpeedMenu, scheduleAutoHide]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Video event handlers
  const handleTimeUpdate = () => {
    if (!videoRef.current || isDraggingScrubber) return;
    setCurrentTime(videoRef.current.currentTime);

    // Compute buffered range
    const b = videoRef.current.buffered;
    if (b.length > 0 && videoRef.current.duration > 0) {
      const cur = videoRef.current.currentTime;
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) <= cur && cur <= b.end(i)) {
          setBufferedPercent((b.end(i) / videoRef.current.duration) * 100);
          break;
        }
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration || 0);
    setHasError(false);
    setIsBuffering(false);
    if (autoPlay) {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().then(() => {
        setIsPlaying(true);
        triggerBigPulse();
      }).catch(() => {});
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
      triggerBigPulse();
    }
  };

  const triggerBigPulse = () => {
    setBigPlayPulse(true);
    setTimeout(() => setBigPlayPulse(false), 500);
  };

  const handleSeekDelta = (deltaSeconds: number) => {
    if (!videoRef.current) return;
    const newTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + deltaSeconds));
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    scheduleAutoHide();
  };

  const handleScrubberSeek = (clientX: number) => {
    if (!scrubberRef.current || !videoRef.current || duration <= 0) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetTime = pos * duration;
    videoRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  const handleScrubberMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDraggingScrubber(true);
    handleScrubberSeek(e.clientX);

    const onMouseMove = (moveEvent: MouseEvent) => {
      handleScrubberSeek(moveEvent.clientX);
    };

    const onMouseUp = () => {
      setIsDraggingScrubber(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleScrubberHover = (e: React.MouseEvent) => {
    if (!scrubberRef.current || duration <= 0) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPosition(pos * 100);
    setHoverTime(pos * duration);
  };

  const handleVolumeChange = (newVolume: number) => {
    const v = Math.max(0, Math.min(1, newVolume));
    setVolume(v);
    setIsMuted(v === 0);
    if (videoRef.current) {
      videoRef.current.volume = v;
      videoRef.current.muted = v === 0;
    }
    localStorage.setItem('drive_player_volume', v.toString());
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    if (isMuted) {
      videoRef.current.muted = false;
      videoRef.current.volume = volume > 0 ? volume : 0.5;
      setIsMuted(false);
      if (volume === 0) setVolume(0.5);
    } else {
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  };

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
    setShowSpeedMenu(false);
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (e) {
      console.warn('PiP error:', e);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Keyboard shortcut listener
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Avoid triggering when focused on input
    if (['input', 'textarea', 'select'].includes((e.target as HTMLElement).tagName.toLowerCase())) {
      return;
    }

    switch (e.key.toLowerCase()) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlay();
        break;
      case 'arrowleft':
      case 'j':
        e.preventDefault();
        handleSeekDelta(-5);
        break;
      case 'arrowright':
      case 'l':
        e.preventDefault();
        handleSeekDelta(5);
        break;
      case 'arrowup':
        e.preventDefault();
        handleVolumeChange(volume + 0.1);
        break;
      case 'arrowdown':
        e.preventDefault();
        handleVolumeChange(volume - 0.1);
        break;
      case 'm':
        e.preventDefault();
        toggleMute();
        break;
      case 'f':
        e.preventDefault();
        toggleFullscreen();
        break;
    }
  };

  const playedPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className={`relative group bg-black rounded-2xl overflow-hidden flex items-center justify-center outline-none select-none ${className} ${
        isFullscreen ? 'w-screen h-screen rounded-none' : ''
      }`}
      onClick={(e) => {
        // Only toggle play if clicking outside controls
        if ((e.target as HTMLElement).closest('.video-controls-bar')) return;
        togglePlay();
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.video-controls-bar')) return;
        toggleFullscreen();
      }}
    >
      {/* Video Surface */}
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => {
          setIsBuffering(false);
          setIsPlaying(true);
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={() => {
          setHasError(true);
          setIsBuffering(false);
          onError?.();
        }}
        className={`w-full h-full object-contain ${isFullscreen ? 'max-h-screen' : 'max-h-[80vh]'}`}
      />

      {/* Buffering Spinner */}
      {isBuffering && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-xs pointer-events-none z-20">
          <div className="p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 flex items-center space-x-3 shadow-2xl">
            <Loader2 className="w-6 h-6 text-[#38BDF8] animate-spin" />
            <span className="text-xs font-semibold text-zinc-200">Buffering video...</span>
          </div>
        </div>
      )}

      {/* Big Play/Pause Center Animation */}
      {bigPlayPulse && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="p-5 rounded-full bg-black/70 border border-white/20 text-white animate-ping backdrop-blur-md">
            {isPlaying ? <Play className="w-8 h-8 fill-current" /> : <Pause className="w-8 h-8 fill-current" />}
          </div>
        </div>
      )}

      {/* Error Fallback Screen */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/95 z-30 p-6">
          <div className="max-w-md p-6 bg-[#121217] border border-zinc-800 rounded-2xl text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-red-950/40 border border-red-800/40 text-red-400 flex items-center justify-center mx-auto">
              <Film className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">Video Playback Error</h4>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                This browser cannot decode this video codec directly. You can download the video or open the direct stream in a new window.
              </p>
            </div>
            <div className="flex items-center justify-center space-x-3 pt-1">
              <a
                href={src}
                download={filename || 'video.mp4'}
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload?.();
                }}
                className="px-4 py-2 bg-[#38BDF8] hover:bg-[#38BDF8]/90 text-black text-xs font-bold rounded-xl flex items-center space-x-1.5 transition active:scale-95 shadow-lg shadow-sky-950/30"
              >
                <Download className="w-4 h-4" />
                <span>Download Video</span>
              </a>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(src, '_blank');
                }}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-xl transition"
              >
                Open Stream
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Header Title (visible on hover) */}
      {filename && (
        <div
          className={`absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent transition-opacity duration-300 pointer-events-none z-20 flex items-center space-x-2 ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <Film className="w-4 h-4 text-[#38BDF8]" />
          <span className="text-xs font-semibold text-white truncate drop-shadow max-w-[80%]">
            {filename}
          </span>
        </div>
      )}

      {/* Bottom Floating Frosted Glass Control Bar */}
      <div
        className={`video-controls-bar absolute bottom-0 left-0 right-0 p-3 sm:p-4 bg-gradient-to-t from-black/95 via-black/70 to-transparent transition-all duration-300 z-20 flex flex-col space-y-2 ${
          showControls || !isPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scrubber / Progress Bar */}
        <div
          ref={scrubberRef}
          onMouseDown={handleScrubberMouseDown}
          onMouseMove={handleScrubberHover}
          onMouseLeave={() => {
            setHoverTime(null);
            setHoverPosition(null);
          }}
          className="relative w-full h-2 hover:h-3 bg-zinc-800/80 rounded-full cursor-pointer transition-all duration-150 flex items-center group/scrubber"
        >
          {/* Buffered track */}
          <div
            className="absolute left-0 top-0 bottom-0 bg-zinc-600/50 rounded-full pointer-events-none transition-all duration-200"
            style={{ width: `${bufferedPercent}%` }}
          />

          {/* Played progress track */}
          <div
            className="absolute left-0 top-0 bottom-0 bg-[#38BDF8] rounded-full pointer-events-none relative shadow-sm"
            style={{ width: `${playedPercent}%` }}
          >
            {/* Scrubber thumb handle */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-md border border-[#38BDF8] scale-0 group-hover/scrubber:scale-100 transition-transform" />
          </div>

          {/* Hover Time Tooltip */}
          {hoverTime !== null && hoverPosition !== null && (
            <div
              className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded-md bg-zinc-900/95 border border-zinc-700 text-[10px] font-mono text-white pointer-events-none shadow-lg z-30"
              style={{ left: `${hoverPosition}%` }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>

        {/* Action Controls Row */}
        <div className="flex items-center justify-between text-white text-xs pt-1">
          {/* Left Controls: Play, -10s, +10s, Volume, Timestamp */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            {/* Play/Pause */}
            <button
              type="button"
              onClick={togglePlay}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition active:scale-95"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current text-[#38BDF8]" />
              ) : (
                <Play className="w-4 h-4 fill-current text-white" />
              )}
            </button>

            {/* Jump -10s */}
            <button
              type="button"
              onClick={() => handleSeekDelta(-10)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-300 hover:text-white transition relative active:scale-95"
              title="Rewind 10s (←)"
            >
              <RotateCcw className="w-4 h-4" />
              <span className="text-[8px] font-bold absolute inset-0 flex items-center justify-center pointer-events-none">
                10
              </span>
            </button>

            {/* Jump +10s */}
            <button
              type="button"
              onClick={() => handleSeekDelta(10)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-300 hover:text-white transition relative active:scale-95"
              title="Forward 10s (→)"
            >
              <RotateCw className="w-4 h-4" />
              <span className="text-[8px] font-bold absolute inset-0 flex items-center justify-center pointer-events-none">
                10
              </span>
            </button>

            {/* Volume & Slider */}
            <div className="flex items-center space-x-1.5 group/volume">
              <button
                type="button"
                onClick={toggleMute}
                className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-300 hover:text-white transition active:scale-95"
                title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-red-400" />
                ) : volume < 0.5 ? (
                  <Volume1 className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                className="w-14 sm:w-20 h-1 bg-zinc-700 accent-[#38BDF8] rounded-lg cursor-pointer transition-all opacity-80 hover:opacity-100"
                title="Volume"
              />
            </div>

            {/* Time Elapsed / Duration */}
            <div className="text-[11px] font-mono text-zinc-400 pl-1 hidden sm:block">
              <span className="text-zinc-200 font-semibold">{formatTime(currentTime)}</span>
              <span className="mx-1 text-zinc-600">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right Controls: Playback Rate, PiP, Fullscreen */}
          <div className="flex items-center space-x-1.5 sm:space-x-2">
            {/* Mobile Time */}
            <span className="text-[10px] font-mono text-zinc-300 sm:hidden pr-1">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            {/* Playback Speed Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSpeedMenu((v) => !v)}
                className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-[11px] font-bold text-zinc-300 hover:text-white transition flex items-center space-x-1"
                title="Playback Speed"
              >
                <span>{playbackRate}x</span>
              </button>

              {showSpeedMenu && (
                <div className="absolute bottom-9 right-0 bg-[#16161c] border border-zinc-800 rounded-xl p-1 shadow-2xl z-30 min-w-[80px] space-y-0.5 backdrop-blur-md">
                  <div className="px-2 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-800">
                    Speed
                  </div>
                  {PLAYBACK_RATES.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => handleSpeedChange(rate)}
                      className={`w-full text-left px-2.5 py-1 text-xs rounded-lg transition font-medium ${
                        playbackRate === rate
                          ? 'bg-[#38BDF8]/20 text-[#38BDF8] font-bold'
                          : 'text-zinc-300 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {rate}x {rate === 1.0 ? '(Normal)' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Picture-in-Picture */}
            {document.pictureInPictureEnabled && (
              <button
                type="button"
                onClick={togglePiP}
                className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-300 hover:text-white transition active:scale-95 hidden sm:block"
                title="Picture-in-Picture"
              >
                <PictureInPicture2 className="w-4 h-4" />
              </button>
            )}

            {/* Fullscreen Toggle */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-300 hover:text-white transition active:scale-95"
              title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
            >
              {isFullscreen ? (
                <Minimize className="w-4 h-4" />
              ) : (
                <Maximize className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
