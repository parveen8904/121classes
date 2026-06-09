"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function AnnouncementSplash() {
  const [show, setShow] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 4600);
    const t2 = setTimeout(() => setShow(false), 5000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (!show) return null;

  return (
    <div
      className={`splash-overlay ${leaving ? "leaving" : ""}`}
      onClick={() => setShow(false)}
      role="dialog"
      aria-label="Announcement"
    >
      <div className="splash-card" onClick={(e) => e.stopPropagation()}>
        <button className="splash-close" onClick={() => setShow(false)} aria-label="Close">
          ×
        </button>
        <div className="splash-head">📢 What&apos;s New</div>
        <div className="splash-body">
          <p>
            May 2026 amendments are now live, and fresh AS 24 revision videos have been
            added by CA Parveen Sharma &amp; team.
          </p>
          <Link className="btn" href="/login" onClick={() => setShow(false)}>
            Explore now
          </Link>
        </div>
      </div>
    </div>
  );
}
