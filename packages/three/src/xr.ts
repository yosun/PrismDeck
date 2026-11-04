import type { WebGLRenderer } from 'three';

export type ImmersiveMode = 'immersive-vr' | 'immersive-ar';

/** Capability detection only. This never requests a session or imports Three.js. */
export async function isXRSupported(mode: ImmersiveMode = 'immersive-vr'): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported(mode);
  } catch {
    return false;
  }
}

/**
 * Call directly from a user gesture, after lazily importing this entry point.
 * Capability detection is deliberately separate so requestSession retains the
 * click's transient activation. No session starts automatically.
 */
export async function enterXR(
  renderer: WebGLRenderer,
  mode: ImmersiveMode = 'immersive-vr',
  init: XRSessionInit = {},
): Promise<XRSession> {
  if (typeof navigator === 'undefined' || !navigator.xr) {
    throw new Error('WebXR is unavailable in this browser or secure context.');
  }
  const existing = renderer.xr.getSession();
  if (existing) return existing;

  const wasEnabled = renderer.xr.enabled;
  let session: XRSession | undefined;
  try {
    // Request immediately, before any await that could consume user activation.
    const requested = navigator.xr.requestSession(mode, init);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    session = await requested;
    session.addEventListener('end', () => { renderer.xr.enabled = wasEnabled; }, { once: true });
    await renderer.xr.setSession(session);
    return session;
  } catch (error) {
    renderer.xr.enabled = wasEnabled;
    if (session) await session.end().catch(() => {});
    throw error;
  }
}
