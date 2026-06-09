"use client";

// A small confirm-then-submit delete form. The server action is passed in,
// so the actual delete runs on the server with the admin's session.
export default function DeleteButton({
  action,
  id,
  parentId,
  label = "Delete",
  message = "Delete this? This cannot be undone.",
}: {
  action: (formData: FormData) => void | Promise<void>;
  id: string;
  parentId?: string;
  label?: string;
  message?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      style={{ display: "inline" }}
    >
      <input type="hidden" name="id" value={id} />
      {parentId !== undefined && <input type="hidden" name="parentId" value={parentId} />}
      <button className="btn small secondary" type="submit">
        {label}
      </button>
    </form>
  );
}
