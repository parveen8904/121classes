"use client";

// One tap to put a message on every account, or to clear them all and pick a
// few. Sixteen checkboxes is the price of having sixteen channels; this is the
// shortcut.
export default function ToggleAllChannels() {
  return (
    <button
      type="button"
      className="btn small secondary"
      onClick={(e) => {
        const form = (e.currentTarget as HTMLElement).closest("form");
        if (!form) return;
        const boxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name^="to_"]'));
        // WhatsApp costs money per message and reaches every contact, so
        // "everywhere" deliberately leaves it alone — it stays a decision.
        const targets = boxes.filter((b) => b.name !== "to_whatsapp");
        const allOn = targets.every((b) => b.checked);
        for (const b of targets) b.checked = !allOn;
      }}
    >
      ☑️ All channels / none <span style={{ fontWeight: 400, opacity: 0.75 }}>(not WhatsApp)</span>
    </button>
  );
}
