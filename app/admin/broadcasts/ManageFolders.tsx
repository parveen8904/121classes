import SubmitButton from "@/app/components/SubmitButton";
import { createFolder, deleteFolder } from "./folder-actions";
import type { Folder } from "./ChannelFolders";

// Create the folders themselves. The founder names them the way he thinks
// about posting — Personal, CA Official, Long messages, Short, Video — and
// ticks which destinations belong in each.
export default function ManageFolders({
  folders,
  boxes,
}: {
  folders: Folder[];
  boxes: { name: string; label: string }[];
}) {
  return (
    <details className="card" style={{ marginBottom: 16 }}>
      <summary className="btn as-btn small secondary">🗂️ Folders — group your channels</summary>

      <p className="muted" style={{ fontSize: ".85rem", marginTop: 10 }}>
        A folder is just a named set of destinations. When you write a post, click a folder and its channels are ticked for
        you — no need to read the whole list every time.
      </p>

      {folders.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
          {folders.map((f) => (
            <div key={f.id} className="list-row">
              <div>
                <div className="row-title">{f.icon ? `${f.icon} ` : ""}{f.name}</div>
                <div className="row-sub muted">
                  {f.channels.length
                    ? f.channels.map((c) => boxes.find((b) => b.name === c)?.label ?? c).join(" · ")
                    : "No channels yet — delete and create it again with channels ticked."}
                </div>
              </div>
              <div className="row-actions">
                <form action={deleteFolder}>
                  <input type="hidden" name="id" value={f.id} />
                  <SubmitButton className="btn small secondary" savedLabel="Removed">Delete</SubmitButton>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      <form action={createFolder} className="form-card">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input name="icon" placeholder="🙂" maxLength={4} style={{ width: 70 }} />
          <input name="name" placeholder="Folder name — e.g. CA Official, Personal, Video" required style={{ flex: "1 1 260px" }} />
        </div>
        <div style={{ display: "grid", gap: 4, gridTemplateColumns: "1fr 1fr", marginTop: 8 }}>
          {boxes.map((b) => (
            <label key={b.name} className="remember" style={{ margin: 0, fontSize: ".82rem" }}>
              <input type="checkbox" name="channels" value={b.name} /> {b.label}
            </label>
          ))}
        </div>
        <SubmitButton className="btn small" savedLabel="✓ Folder created" style={{ marginTop: 10 }}>＋ Create folder</SubmitButton>
      </form>
    </details>
  );
}
