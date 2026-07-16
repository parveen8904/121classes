"use client";

// One-tap "save as PDF" for sharing the guide with the team. Opens every
// <details> first so the print includes all steps, then restores the view.
export default function PrintButton() {
  function onPrint() {
    const all = Array.from(document.querySelectorAll("details"));
    const wasOpen = all.map((d) => d.open);
    all.forEach((d) => { d.open = true; });
    window.print();
    all.forEach((d, i) => { d.open = wasOpen[i]; });
  }
  return (
    <button className="btn small" onClick={onPrint}>🖨️ Print / save as PDF</button>
  );
}
