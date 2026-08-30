import { registerSW } from 'virtual:pwa-register';
import { APP_VERSION, fetchLiveAppVersion } from '../config';

/**
 * PWA Automatic Update & Lifecycle Management Service
 * 
 * Guarantees:
 * 1. Immediate detection of new deployments.
 * 2. Instant activation via skipWaiting() and clients.claim().
 * 3. Automatic cache versioning and obsolete cache purging.
 * 4. Seamless single automatic refresh with a non-blocking banner.
 * 5. Full preservation of IndexedDB, Firestore cache, downloaded notes, and auth sessions.
 * 6. Continuous offline capability.
 * 7. Prevention of duplicate reloads or infinite reload loops.
 */

let isRefreshing = false;
let updateBannerElement: HTMLElement | null = null;

/**
 * Displays a non-blocking floating banner informing the user that an update is being applied.
 */
export function showUpdatingBanner(): void {
  if (updateBannerElement || document.getElementById('pwa-updating-banner')) {
    return;
  }

  try {
    const banner = document.createElement('div');
    banner.id = 'pwa-updating-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    
    // Style as a clean, non-blocking floating pill at top center
    banner.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999999;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 18px;
      background: rgba(15, 23, 42, 0.95);
      color: #ffffff;
      border: 1px solid rgba(59, 130, 246, 0.4);
      border-radius: 9999px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: -0.01em;
      pointer-events: none;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      animation: pwaSlideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    `;

    banner.innerHTML = `
      <style>
        @keyframes pwaSlideDown {
          from { opacity: 0; transform: translate(-50%, -20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        @keyframes pwaSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      </style>
      <div style="width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.25); border-top-color: #60a5fa; border-radius: 50%; animation: pwaSpin 0.7s linear infinite;"></div>
      <span>A new version is available. Updating…</span>
    `;

    document.body.appendChild(banner);
    updateBannerElement = banner;
  } catch (e) {
    console.warn('[PWA Update] Could not render updating banner DOM element:', e);
  }
}

/**
 * Removes outdated CacheStorage entries from previous versions.
 * Leaves IndexedDB, LocalStorage, and downloaded notes cache completely intact.
 */
export async function purgeOutdatedCaches(activeVersion: string = APP_VERSION): Promise<void> {
  if (!('caches' in window)) return;
  try {
    const cacheKeys = await window.caches.keys();
    for (const key of cacheKeys) {
      // If it is a tuition-pwa cache or workbox precache but doesn't include the active version
      if (
        (key.startsWith('tuition-pwa-') || key.startsWith('workbox-precache-')) &&
        !key.includes(activeVersion)
      ) {
        console.log(`[PWA Update] Deleting obsolete cache key: ${key}`);
        await window.caches.delete(key);
      }
    }
  } catch (err) {
    console.warn('[PWA Update] Error during cache cleanup:', err);
  }
}

/**
 * Performs a single safe reload after update activation.
 */
function triggerSafeReload(reason: string): void {
  if (isRefreshing) return;

  const sessionReloadKey = 'pwa_last_refresh_timestamp';
  const lastReload = Number(sessionStorage.getItem(sessionReloadKey) || '0');
  
  // Guard against duplicate reloads within 6 seconds
  if (Date.now() - lastReload < 6000) {
    console.log('[PWA Update] Skipping duplicate reload trigger (cooldown active)');
    return;
  }

  isRefreshing = true;
  sessionStorage.setItem(sessionReloadKey, String(Date.now()));
  console.log(`[PWA Update] Executing single safe reload. Reason: ${reason}`);

  showUpdatingBanner();

  // Small delay so users see smooth feedback and SW state settles
  setTimeout(() => {
    window.location.reload();
  }, 750);
}

/**
 * Checks if the running application version matches the deployment version.
 * If older, triggers background cache purge and single safe refresh.
 */
export async function checkVersionMismatch(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    const live = await fetchLiveAppVersion();
    if (!live || !live.version) return false;

    const remoteVersion = live.version.trim();
    const currentVersion = APP_VERSION.trim();

    if (remoteVersion && remoteVersion !== currentVersion) {
      console.log(`[PWA Update] Version mismatch detected. Current: "${currentVersion}", Live: "${remoteVersion}"`);

      const versionRefreshKey = `pwa_refreshed_for_${remoteVersion}`;
      if (sessionStorage.getItem(versionRefreshKey)) {
        return false;
      }

      sessionStorage.setItem(versionRefreshKey, 'true');
      await purgeOutdatedCaches(remoteVersion);

      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update().catch(() => {});
        }
      }

      triggerSafeReload(`Version mismatch (Current ${currentVersion} -> Live ${remoteVersion})`);
      return true;
    }
  } catch (err) {
    console.warn('[PWA Update] Version check error:', err);
  }
  return false;
}

/**
 * Initializes the PWA Service Worker lifecycle and automatic update detection.
 */
export function initPwaUpdateService(): void {
  // Purge any residual obsolete caches from previous versions on startup
  purgeOutdatedCaches(APP_VERSION).catch(() => {});

  if (!('serviceWorker' in navigator)) {
    console.log('[PWA Update] Service Worker not supported in this browser.');
    return;
  }

  // 1. Listen for Service Worker controller changes (when skipWaiting & clientsClaim takes over)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('[PWA Update] New Service Worker has taken control of the page.');
    triggerSafeReload('Service Worker controller changed');
  });

  // 2. Register Service Worker with immediate update capability
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      console.log('[PWA Update] onNeedRefresh triggered. Activating new Service Worker immediately...');
      showUpdatingBanner();
      updateSW(true);
    },
    onOfflineReady() {
      console.log('[PWA Update] Application is ready for offline operation.');
    },
    onRegisteredSW(swUrl, registration) {
      if (!registration) return;
      console.log(`[PWA Update] Service Worker registered successfully at: ${swUrl}`);

      // Inspect registration for newly installing worker
      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        console.log('[PWA Update] New Service Worker found, downloading update...');

        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              console.log('[PWA Update] New version installed and ready. Activating...');
              showUpdatingBanner();
              installingWorker.postMessage({ type: 'SKIP_WAITING' });
              updateSW(true);
            }
          }
        });
      });

      // Periodic check for new updates every 60 seconds when online
      setInterval(() => {
        if (navigator.onLine) {
          registration.update().catch(() => {});
          checkVersionMismatch().catch(() => {});
        }
      }, 60 * 1000);

      // Check for update immediately when window gains focus or becomes visible (e.g. reopened from home screen)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          registration.update().catch(() => {});
          checkVersionMismatch().catch(() => {});
        }
      });

      window.addEventListener('focus', () => {
        if (navigator.onLine) {
          registration.update().catch(() => {});
          checkVersionMismatch().catch(() => {});
        }
      });

      // Check for updates when coming back online
      window.addEventListener('online', () => {
        registration.update().catch(() => {});
        checkVersionMismatch().catch(() => {});
      });
    },
    onRegisterError(error) {
      console.warn('[PWA Update] Service Worker registration failed:', error);
    },
  });

  // Initial runtime version verification 2 seconds after boot
  setTimeout(() => {
    checkVersionMismatch().catch(() => {});
  }, 2000);
}
