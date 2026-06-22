"use client";

import { useState } from "react";

// Subject dropdown + a live topic ticklist for the chosen subject's paper, shown
// right when the plan is being built. Ticked topics are done in the exhaustive
// stage AND revised in the revision rounds (overrides the scope preset).
export default function TopicPicker({
  subjects,
  topicsBySubject,
  defaultSubjectId,
  pickedIds,
}: {
  subjects: { id: string; title: string }[];
  topicsBySubject: Record<string, { id: string; title: string }[]>;
  defaultSubjectId: string;
  pickedIds: string[];
}) {
  const [subjectId, setSubjectId] = useState(defaultSubjectId || "");
  const picked = new Set(pickedIds);
  const topics = topicsBySubject[subjectId] ?? [];

  return (
    <>
      <div>
        <label>Subject (which paper)</label>
        <select name="subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} required>
          <option value="" disabled>Choose your subject…</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </div>
      {topics.length > 0 && (
        <div>
          <label>Pick topics (optional)</label>
          <p className="muted" style={{ fontSize: ".78rem", margin: "0 0 6px" }}>
            Tick the topics to study. Leave all unticked to use the scope option below. Ticked topics are done in the exhaustive stage and revised in the revision rounds.
          </p>
          <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
            {topics.map((t) => (
              <label key={t.id} style={{ display: "block", fontSize: ".85rem", padding: "2px 0" }}>
                <input type="checkbox" name="pick" value={t.id} defaultChecked={picked.has(t.id)} /> {t.title}
              </label>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
