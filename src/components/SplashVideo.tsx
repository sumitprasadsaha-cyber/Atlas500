import React, { useEffect, useRef, useState } from "react";

interface SplashVideoProps {
  onComplete: () => void;
}

export const SplashVideo: React.FC<SplashVideoProps> = ({ onComplete }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const completedRef = useRef(false);
  const [isVideoEnded, setIsVideoEnded] = useState(false);

  const handleFinish = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    setIsVideoEnded(true);

    // Release and dispose video element resources to avoid memory leaks
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.removeAttribute("src");
        videoRef.current.load();
      } catch (err) {
        console.warn("[SplashVideo] Error during video resource release:", err);
      }
    }

    onComplete();
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      handleFinish();
      return;
    }

    // Attempt autoplay with sound
    video.muted = false;

    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch((error) => {
        console.warn("[SplashVideo] Unmuted autoplay prevented by browser policy:", error);
        // Fallback: try autoplay muted if unmuted autoplay is blocked by the browser/WebView
        if (video && !completedRef.current) {
          video.muted = true;
          video.play().catch((playErr) => {
            console.warn("[SplashVideo] Autoplay completely blocked or failed:", playErr);
            handleFinish();
          });
        }
      });
    }

    // Watchdog fallback timer (e.g. 10s max duration) in case video hangs, fails, or cannot load
    const safetyTimeout = setTimeout(() => {
      if (!completedRef.current) {
        console.warn("[SplashVideo] Splash screen safety timeout reached");
        handleFinish();
      }
    }, 10000);

    return () => {
      clearTimeout(safetyTimeout);
      if (video) {
        try {
          video.pause();
          video.removeAttribute("src");
          video.load();
        } catch {
          // ignore cleanup errors on unmount
        }
      }
    };
  }, []);

  if (isVideoEnded) {
    return null;
  }

  return (
    <div
      id="splash-video-container"
      className="fixed inset-0 z-[999999] w-screen h-screen bg-black flex items-center justify-center overflow-hidden select-none pointer-events-none"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 999999,
        backgroundColor: "#000000",
        pointerEvents: "none",
        userSelect: "none",
      }}
      aria-hidden="true"
    >
      <video
        ref={videoRef}
        id="splash-video-element"
        src="/assets/splash.mp4"
        className="w-full h-full object-cover"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
        playsInline
        autoPlay
        preload="auto"
        controls={false}
        disablePictureInPicture
        disableRemotePlayback
        onEnded={handleFinish}
        onError={(e) => {
          console.warn("[SplashVideo] Video playback error:", e);
          handleFinish();
        }}
      />
    </div>
  );
};
export default SplashVideo;
