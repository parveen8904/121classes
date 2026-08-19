"use client";

// THE PHONE'S OWN WATCH LEDGER, and the fair-use meter it enforces offline.
//
// Three small jobs, all in localStorage because a downloaded class is watched
// with no connection:
//
//   noteOfflineWatch — the offline player calls this every few seconds while a
//     class plays. Position and minutes accumulate per class, safe across app
//     restarts.
//   flushOfflineWatch — whenever the app is online, the queue is posted to
//     /api/watch-sync, which writes it exactly as live watching is written. The
//     reply carries each subject's remaining fair-use allowance, cached here.
//   offlineAllowance — what the player asks before and during playback: how
//     many seconds does this subject have left, counting what has been watched
//     offline but not yet synced?
//
// Enforcement offline is honest but approximate: the phone cannot ask the
// server mid-flight, so it counts down from the last synced figure. Every sync
// trues it up. A student who has never synced (an old download, a cleared
// cache) is NOT blocked — punishing the unknown would lock out students on old
// app versions — the next online moment brings the truth.

const QUEUE_KEY = "watch.queue.v1";
const SUBJ_KEY = "watch.subj.v1";    // sectionId → subjectId
const ALLOW_KEY = "watch.allow.v1";  // subjectId → { remainingSeconds, unlimited, at }

type QueueRec = { videoSeconds: number; realSeconds: number; durationSeconds: number };

function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || "") as T; } catch { return fallback; }
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full — the class still plays */ }
}

export function noteOfflineWatch(sectionId: string, r: { videoSeconds: number; deltaRealSeconds: number; durationSeconds: number }) {
  if (!sectionId) return;
  const q = read<Record<string, QueueRec>>(QUEUE_KEY, {});
  const cur = q[sectionId] ?? { videoSeconds: 0, realSeconds: 0, durationSeconds: 0 };
  q[sectionId] = {
    videoSeconds: Math.max(cur.videoSeconds, Math.round(r.videoSeconds || 0)),
    realSeconds: cur.realSeconds + Math.max(0, Math.round(r.deltaRealSeconds || 0)),
    durationSeconds: Math.round(r.durationSeconds || cur.durationSeconds || 0),
  };
  write(QUEUE_KEY, q);
}

/** Post the queue when online; cache the fair-use allowances that come back. */
export async function flushOfflineWatch(wantSections: string[] = []): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const q = read<Record<string, QueueRec>>(QUEUE_KEY, {});
  const records = Object.entries(q).map(([sectionId, r]) => ({ sectionId, ...r }));
  if (!records.length && !wantSections.length) return;
  try {
    const res = await fetch("/api/watch-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records, wantSections }),
    });
    if (!res.ok) return; // keep the queue; try again next time we are online
    const j = (await res.json()) as {
      sections?: Record<string, string>;
      allowances?: Record<string, { remainingSeconds: number; unlimited: boolean }>;
    };
    // The server has the seconds now — the queue's job is done.
    write(QUEUE_KEY, {});
    if (j.sections) {
      const map = read<Record<string, string>>(SUBJ_KEY, {});
      write(SUBJ_KEY, { ...map, ...j.sections });
    }
    if (j.allowances) {
      const now = Date.now();
      const cur = read<Record<string, { remainingSeconds: number; unlimited: boolean; at: number }>>(ALLOW_KEY, {});
      for (const [subj, a] of Object.entries(j.allowances)) cur[subj] = { ...a, at: now };
      write(ALLOW_KEY, cur);
    }
  } catch { /* offline after all, or the server blinked — the queue survives */ }
}

/**
 * Seconds this class's subject may still be watched, or null when unknown /
 * unlimited. Unknown is deliberately not a block.
 */
export function offlineAllowance(sectionId: string): number | null {
  const subj = read<Record<string, string>>(SUBJ_KEY, {})[sectionId];
  if (!subj) return null;
  const a = read<Record<string, { remainingSeconds: number; unlimited: boolean; at: number }>>(ALLOW_KEY, {})[subj];
  if (!a || a.unlimited) return null;
  // What has been watched offline since that allowance was fetched, across ALL
  // classes of the same subject — a cap dodged by switching chapters is no cap.
  const map = read<Record<string, string>>(SUBJ_KEY, {});
  const q = read<Record<string, QueueRec>>(QUEUE_KEY, {});
  let queued = 0;
  for (const [sec, r] of Object.entries(q)) if (map[sec] === subj) queued += r.realSeconds;
  return Math.max(0, a.remainingSeconds - queued);
}
