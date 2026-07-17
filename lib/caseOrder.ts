// Case-scenario display numbering. Students see clean "Case Scenario 1..N"
// labels, but the mapping to the underlying case is SCRAMBLED (deterministic
// hash of the case id) — so on-screen "Case Scenario 1" is a random case, not
// the source's Case 1, and a student can't look it up in the ICAI material by
// number. Deterministic = the same student always sees the same number.

function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

// Returns caseId → display number (1..N), assigned in scrambled order.
export function caseDisplayNumbers(cases: { id: string }[]): Map<string, number> {
  const ordered = [...cases].sort((a, b) => {
    const d = hashId(a.id) - hashId(b.id);
    return d !== 0 ? d : a.id.localeCompare(b.id); // stable tiebreak
  });
  const m = new Map<string, number>();
  ordered.forEach((c, i) => m.set(c.id, i + 1));
  return m;
}
