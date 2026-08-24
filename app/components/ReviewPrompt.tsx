"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// ASKING FOR THE GOOGLE REVIEW — AND WHAT THE EXISTING REVIEWS SAY TO DO.
//
// 133 reviews, 3.9 stars, most of them years old and from the offline centre.
// Reading all of them settles how this should behave: EVERY negative review is
// about administration — a payment that went unanswered, a branch that had
// closed, a rude phone call — and EVERY positive one is about the teaching.
// Nobody has ever criticised a class.
//
// So the ask goes to students who have actually been taught: signed in, on the
// dashboard or in the learning area — which already covers the descriptive
// paper, the MCQ chapter tests and the case studies, since those all live
// under /learn — plus the planner and the career page, after using the site
// on three separate days. Not to a visitor, not mid-payment, not to somebody
// who arrived today.
//
// TWO RULES THIS MUST NOT BREAK.
//
//   1. IT ASKS EVERYONE. It does not ask "are you happy?" and route the happy
//      ones to Google and the unhappy ones somewhere quiet. That is review
//      gating, it is against Google's policy, and listings lose their reviews
//      over it. The link is offered to every student who meets the timing,
//      whatever they think of us.
//
//   2. "SOMETHING'S WRONG" SITS BESIDE IT, NOT INSTEAD OF IT. Both buttons are
//      shown together and the review link is never withheld. Given that the
//      complaints are all about administration, a student with a real problem
//      should be able to reach a person — but if they would rather write the
//      review, nothing stops them.
//
// The in-app store rating (RatePrompt) is deliberately kept separate: a student
// inside the phone app is asked for a Play Store or App Store rating, and only
// a student on the web is asked for the Google listing. Nobody is asked twice.

const SHOW_ON = ["/dashboard", "/learn", "/planner", "/career"];
const K_DAYS = "grev.days";
const K_LAST = "grev.lastAsk";
const K_DONE = "grev.done";
const K_DISMISS = "grev.dismissCount";

export default function ReviewPrompt({ url }: { url?: string | null }) {
  const pathname = usePathname() || "/";
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!url) return;
      if (!SHOW_ON.some((p) => pathname === p || pathname.startsWith(p + "/"))) return;
      // Inside the phone app the store rating is the right ask, not this one.
      if (document.documentElement.classList.contains("in-app")) return;
      if (localStorage.getItem(K_DONE)) return;

      const today = new Date().toISOString().slice(0, 10);
      const days: string[] = JSON.parse(localStorage.getItem(K_DAYS) || "[]");
      if (!days.includes(today)) {
        days.push(today);
        localStorage.setItem(K_DAYS, JSON.stringify(days.slice(-30)));
      }
      if (days.length < 3) return;

      const last = Number(localStorage.getItem(K_LAST) || 0);
      if (last && Date.now() - last < 60 * 86400e3) return;

      // Let them get on with what they opened the page for first.
      const t = setTimeout(() => {
        localStorage.setItem(K_LAST, String(Date.now()));
        setShow(true);
      }, 25000);
      return () => clearTimeout(t);
    } catch { /* storage unavailable — never break the page */ }
  }, [pathname, url]);

  if (!show || !url) return null;

  function close(done = false) {
    try {
      if (done) localStorage.setItem(K_DONE, "1");
      else {
        const n = Number(localStorage.getItem(K_DISMISS) || 0) + 1;
        localStorage.setItem(K_DISMISS, String(n));
        // Asked twice and ignored twice is an answer. Stop asking.
        if (n >= 2) localStorage.setItem(K_DONE, "1");
      }
    } catch { /* ignore */ }
    setShow(false);
  }

  return (
    <div style={{ position: "fixed", left: 12, right: 12, bottom: 14, zIndex: 8500, display: "flex", justifyContent: "center" }}>
      <div className="card" style={{ maxWidth: 460, width: "100%", boxShadow: "0 6px 24px rgba(0,0,0,.35)" }}>
        <strong>Has this helped your preparation? 🙏</strong>
        <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 10px", lineHeight: 1.6 }}>
          A minute of your time on Google helps the next CA student find these classes. Write whatever is
          true — it is more useful to them than anything we could say about ourselves.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <a className="btn small" href={url} target="_blank" rel="noopener noreferrer" onClick={() => close(true)}>
            ⭐ Write a Google review
          </a>
          <a className="btn small secondary" href="/support" onClick={() => close(true)}>
            🛠 Something needs fixing
          </a>
          <button className="btn small secondary" onClick={() => close(false)} style={{ marginLeft: "auto" }}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
