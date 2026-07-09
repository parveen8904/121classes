import { getOfflineKey } from "./actions";

export type OfflineLicense = { key: string };

// Play-key resolution that works in AIRPLANE MODE: online we always ask the
// server (fresh access check; revocations stick) and mirror the answer into
// localStorage; offline we fall back to the mirrored key saved at download
// time. Without this, offline playback dies on the key fetch ("Load failed").
export async function resolveOfflineKey(id: string): Promise<OfflineLicense | null> {
  try {
    const lic = await getOfflineKey(id);
    if (lic) localStorage.setItem(`offkey:${id}`, JSON.stringify(lic));
    else localStorage.removeItem(`offkey:${id}`); // access denied/expired — drop the mirror
    return lic as OfflineLicense | null;
  } catch {
    // Offline (or server hiccup) — use the key mirrored while online.
    try {
      const raw = localStorage.getItem(`offkey:${id}`);
      return raw ? (JSON.parse(raw) as OfflineLicense) : null;
    } catch {
      return null;
    }
  }
}

// Fire-and-forget mirror right after a download completes, so the class is
// playable offline even if the student never plays it while online first.
export function cacheOfflineKey(id: string): void {
  void resolveOfflineKey(id);
}
