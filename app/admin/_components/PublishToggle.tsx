// A tiny form that flips a published flag via a server action.
export default function PublishToggle({
  action,
  id,
  published,
}: {
  action: (formData: FormData) => void | Promise<void>;
  id: string;
  published: boolean;
}) {
  return (
    <form action={action} style={{ display: "inline" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="next" value={published ? "false" : "true"} />
      <button className="btn small secondary" type="submit">
        {published ? "Unpublish" : "Publish"}
      </button>
    </form>
  );
}
