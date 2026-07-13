"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Live dashboard: quietly re-fetch the server snapshot every N seconds so staff
// can leave this page open on a screen and watch the load in real time.
export default function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [on, seconds, router]);
  return (
    <label className="remember" style={{ margin: 0, fontSize: ".82rem" }}>
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />{" "}
      Auto-refresh every {seconds}s
    </label>
  );
}
