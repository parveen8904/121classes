"use client";

// Opens the browser print dialog → the student saves the plan as a PDF.
// The plan table + cards print; app chrome + controls are hidden via @media print.
export default function PrintButton() {
  return (
    <button type="button" className="btn small secondary no-print" onClick={() => window.print()}>
      🖨️ Print
    </button>
  );
}
