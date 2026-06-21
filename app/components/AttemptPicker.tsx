"use client";

import { useState } from "react";

// CA exams are held only in these four months.
const MONTHS = ["January", "May", "September", "November"];

// A standard attempt picker: pick a month + a year → produces "May 2026".
// Drop-in for any form field — submits a single hidden input under `name`.
// Parses existing values like "May 2026" or the old "MAY_2026".
export default function AttemptPicker({
  name,
  defaultValue = "",
  required = false,
  allowNone = false,
  years = 7,
}: {
  name: string;
  defaultValue?: string;
  required?: boolean;
  allowNone?: boolean;
  years?: number;
}) {
  const m = (defaultValue || "").replace(/_/g, " ").trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  const initMonth = m ? (MONTHS.find((mo) => mo.toLowerCase() === m[1].toLowerCase()) ?? "") : "";
  const initYear = m ? m[2] : "";

  const [month, setMonth] = useState(initMonth);
  const [year, setYear] = useState(initYear);

  const thisYear = new Date().getFullYear();
  const yearOpts = Array.from({ length: years }, (_, i) => String(thisYear + i));
  if (initYear && !yearOpts.includes(initYear)) yearOpts.unshift(initYear);

  const value = month && year ? `${month} ${year}` : "";

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <select value={month} onChange={(e) => setMonth(e.target.value)} required={required} style={{ minWidth: 140 }}>
        <option value="">{allowNone ? "— none —" : "Month…"}</option>
        {MONTHS.map((mo) => (
          <option key={mo} value={mo}>{mo}</option>
        ))}
      </select>
      <select value={year} onChange={(e) => setYear(e.target.value)} required={required} style={{ minWidth: 110 }}>
        <option value="">Year…</option>
        {yearOpts.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
