"use client";

import { useEffect, useRef, useState } from "react";

const track = {
  src: "/audio/if-we-meet-again.mp3",
  title: "如果再见 · 韦礼安",
} as const;

export function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const wantsPlaybackRef = useRef(true);
  const [playing, setPlaying] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.45;

    const tryPlay = () => {
      if (!wantsPlaybackRef.current || !audio.paused) return;
      void audio.play().catch(() => {
        // Browsers may require a user gesture before audible playback.
      });
    };

    tryPlay();
    const retryAfterInteraction = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".background-music-toggle")) {
        return;
      }
      tryPlay();
    };

    document.addEventListener("pointerdown", retryAfterInteraction);
    document.addEventListener("keydown", retryAfterInteraction);
    return () => {
      document.removeEventListener("pointerdown", retryAfterInteraction);
      document.removeEventListener("keydown", retryAfterInteraction);
    };
  }, []);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      wantsPlaybackRef.current = true;
      void audio.play().catch(() => setPlaying(false));
    } else {
      wantsPlaybackRef.current = false;
      audio.pause();
    }
  };

  const label = unavailable ? "音乐暂不可用" : playing ? "暂停音乐" : "播放音乐";

  return (
    <div className="background-music">
      <audio
        ref={audioRef}
        src={track.src}
        loop
        preload="none"
        onPlay={() => {
          setPlaying(true);
          setUnavailable(false);
        }}
        onPause={() => setPlaying(false)}
        onError={() => setUnavailable(true)}
      />
      <button
        type="button"
        className="background-music-toggle"
        aria-label={label}
        aria-pressed={playing}
        title={track.title}
        onClick={togglePlayback}
      >
        <span className="background-music-symbol" aria-hidden="true">
          {playing ? "Ⅱ" : "♪"}
        </span>
        <span>{label}</span>
      </button>
    </div>
  );
}
