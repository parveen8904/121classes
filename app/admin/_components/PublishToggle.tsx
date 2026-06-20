import SubmitButton from "@/app/components/SubmitButton";

// A tiny form that flips a published flag via a server action — with a spinner
// while it runs and a brief "✓ Saved" when done.
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
      <SubmitButton className="btn small secondary">
        {published ? "Unpublish" : "Publish"}
      </SubmitButton>
    </form>
  );
}
