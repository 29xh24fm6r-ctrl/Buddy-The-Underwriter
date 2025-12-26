/**
 * Stitch Navigation Guard
 * 
 * Prevents Stitch iframes from manipulating browser history.
 * This ensures all navigation flows through our route resolver.
 */

/**
 * Install hard guard against iframe navigation
 * 
 * Blocks:
 * - history.pushState
 * - history.replaceState
 * - window.location assignment (best effort)
 * 
 * @param iframe - The iframe element to guard
 */
export function installStitchNavigationGuard(iframe: HTMLIFrameElement) {
  // Guard is installed after iframe loads
  const install = () => {
    try {
      const win = iframe.contentWindow;
      if (!win) {
        console.warn("[StitchGuard] No contentWindow available");
        return;
      }

      // Block history manipulation
      const originalPushState = win.history.pushState;
      const originalReplaceState = win.history.replaceState;

      win.history.pushState = function (...args: any[]) {
        console.warn("[STITCH BLOCKED] history.pushState prevented");
        // Don't call original - this is intentional blocking
        return;
      };

      win.history.replaceState = function (...args: any[]) {
        console.warn("[STITCH BLOCKED] history.replaceState prevented");
        // Don't call original - this is intentional blocking
        return;
      };

      // Attempt to block direct location changes
      // Note: This may not work in all browsers due to security
      try {
        let locationDescriptor = Object.getOwnPropertyDescriptor(win, "location");
        if (!locationDescriptor) {
          locationDescriptor = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(win),
            "location"
          );
        }

        if (locationDescriptor && locationDescriptor.configurable) {
          Object.defineProperty(win, "location", {
            ...locationDescriptor,
            set: function (value: any) {
              console.warn("[STITCH BLOCKED] location assignment prevented:", value);
              // Don't call original setter
            },
          });
        }
      } catch (e) {
        // Security restrictions may prevent this
        console.debug("[StitchGuard] Could not override location (expected in some browsers)");
      }

      console.debug("[StitchGuard] Navigation guard installed successfully");
    } catch (e) {
      // Same-origin policy may prevent access
      // This is expected for cross-origin iframes
      console.debug("[StitchGuard] Guard installation skipped (cross-origin or security):", e);
    }
  };

  // Install on load
  if (iframe.contentWindow && iframe.contentDocument?.readyState === "complete") {
    install();
  } else {
    iframe.addEventListener("load", install, { once: true });
  }
}

/**
 * Check if an iframe has navigation guard installed
 * 
 * @param iframe - The iframe to check
 * @returns true if guard is active (best effort)
 */
export function hasNavigationGuard(iframe: HTMLIFrameElement): boolean {
  try {
    const win = iframe.contentWindow;
    if (!win) return false;

    // Check if pushState is our guarded version
    const fnString = win.history.pushState.toString();
    return fnString.includes("STITCH BLOCKED");
  } catch {
    return false;
  }
}
