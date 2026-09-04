import { createServiceClient } from "@/lib/supabase/service";
import { unsubscribeTokenValid } from "@/lib/unsubscribe";
import { confirmUnsubscribe, resubscribe } from "./actions";
import SubmitButton from "@/app/components/SubmitButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

// THE PAGE A STUDENT LANDS ON WHEN THEY HAVE HAD ENOUGH.
//
// It does NOT unsubscribe on arrival. Mail providers and corporate scanners
// follow every link in a message to check it is safe; a GET that unsubscribed
// would take people off the list who never clicked anything. So arriving shows
// the address and asks; one press does it.
export default async function UnsubscribePage(props: {
  searchParams: Promise<{ e?: string; t?: string; done?: string; back?: string; bad?: string }>;
}) {
  const q = await props.searchParams;
  const email = String(q.e ?? "").trim().toLowerCase();
  const token = String(q.t ?? "").trim();

  const shell = (children: React.ReactNode) => (
    <section className="container" style={{ maxWidth: 560, paddingTop: 60, paddingBottom: 80 }}>
      <div className="card">{children}</div>
    </section>
  );

  if (q.done) {
    return shell(
      <>
        <h1 style={{ fontSize: "1.3rem", marginTop: 0 }}>Done — we have stopped.</h1>
        <p style={{ lineHeight: 1.7 }}>
          No further emails will be sent to <strong>{email}</strong>. That applies to everything this
          site sends, not just the message you clicked from.
        </p>
        <p className="muted" style={{ fontSize: ".86rem", lineHeight: 1.7 }}>
          Changed your mind? You can turn them back on here — the link in your email keeps working.
        </p>
        {token && (
          <form action={resubscribe}>
            <input type="hidden" name="e" value={email} />
            <input type="hidden" name="t" value={token} />
            <SubmitButton className="btn small secondary">Start sending again</SubmitButton>
          </form>
        )}
      </>,
    );
  }

  if (q.back) {
    return shell(
      <>
        <h1 style={{ fontSize: "1.3rem", marginTop: 0 }}>You are back on.</h1>
        <p style={{ lineHeight: 1.7 }}>Emails to <strong>{email}</strong> will resume.</p>
      </>,
    );
  }

  const ok = email && (await unsubscribeTokenValid(email, token));
  if (!ok) {
    return shell(
      <>
        <h1 style={{ fontSize: "1.3rem", marginTop: 0 }}>That link is not one of ours.</h1>
        <p style={{ lineHeight: 1.7 }}>
          It may have been cut short by your mail app. Reply to any email from us with the word
          <strong> unsubscribe</strong> and we will stop — a person reads that.
        </p>
      </>,
    );
  }

  const { data: already } = await createServiceClient()
    .from("email_blocklist").select("email").eq("channel", "email").eq("email", email).maybeSingle();

  return shell(
    <>
      <h1 style={{ fontSize: "1.3rem", marginTop: 0 }}>Stop emails to this address?</h1>
      <p style={{ lineHeight: 1.7 }}>
        <strong>{email}</strong>
      </p>
      {already ? (
        <p className="muted" style={{ lineHeight: 1.7 }}>
          This address is already unsubscribed — nothing further is being sent to it.
        </p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: ".9rem", lineHeight: 1.7 }}>
            One press and we stop writing to you. This covers everything the site sends — reminders,
            answers, receipts and notices — not only the kind of message you clicked from.
          </p>
          <form action={confirmUnsubscribe}>
            <input type="hidden" name="e" value={email} />
            <input type="hidden" name="t" value={token} />
            <SubmitButton className="btn">Yes, stop emailing me</SubmitButton>
          </form>
          <p className="muted" style={{ fontSize: ".82rem", marginTop: 12, lineHeight: 1.6 }}>
            If you still hold a subscription, your access is unaffected — this only stops email.
          </p>
        </>
      )}
    </>,
  );
}
