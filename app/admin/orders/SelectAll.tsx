"use client";

// "Select all" for the accountant's Zoho push: ticks/unticks every row
// checkbox (they live outside the bulk form, linked via form="zoho-bulk").
export default function SelectAll() {
  return (
    <label className="remember" style={{ margin: 0, fontWeight: 700, fontSize: ".85rem" }}>
      <input
        type="checkbox"
        onChange={(e) => {
          document.querySelectorAll<HTMLInputElement>('input[name="zoho_ids"]').forEach((c) => { c.checked = e.target.checked; });
        }}
      />{" "}
      Select all
    </label>
  );
}
