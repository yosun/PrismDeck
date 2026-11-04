/** Optional loader. Import this subpath only when an app offers spatial mode. */
export async function loadSpatialRenderer(options: {optIn?: boolean; mode?: 'immersive-vr' | 'immersive-ar'} = {}) {
  let supported = false;
  const xr = typeof navigator !== 'undefined' ? (navigator as Navigator & {xr?: {isSessionSupported(mode: string): Promise<boolean>}}).xr : undefined;
  if (xr) {
    try { supported = await xr.isSessionSupported(options.mode ?? 'immersive-vr'); } catch { /* no immersive capability */ }
  }
  if (!supported && !options.optIn) return null;
  return import('@prismdeck/three');
}
