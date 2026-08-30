# Ordering work by email

Write to a private address, the work happens on the Mac, the answer comes back
on the same thread. The portal half is built and deployed. The runner is not
running yet — the steps below start it.

**The switch ships OFF. Nothing can happen until step 5.**

---

## 1 · Pick the address and the passphrase

On **Admin → Integrations**, set four keys:

| Key | What to put |
|---|---|
| `AGENT_EMAIL_LOCAL` | `do` — so the address is `do@caparveensharma.com` |
| `AGENT_EMAIL_SECRET` | **A passphrase only you know.** Three or four unrelated words. Not a password you use anywhere else, and never send it to anyone |
| `AGENT_EMAIL_ALLOWED` | `ps.smay@gmail.com` — add more, comma separated, only if you mean it |
| `AGENT_RUNNER_KEY` | A long random string. Generate it with `openssl rand -hex 32` |

`AGENT_RUNNER_KEY` is the Mac's credential and `AGENT_EMAIL_SECRET` is the
thing you type into a mail client. **They must be different.** If they were the
same, either one leaking would be both leaking.

## 2 · Route the address in Mailgun

Mailgun → Receiving → Routes. Add a route matching `do@caparveensharma.com`
that forwards to the same inbound URL the other addresses already use. If you
already have a catch-all pointing there, nothing to do.

## 3 · Start the runner on the Mac

```bash
AGENT_RUNNER_KEY='the key from step 1' node ~/121classes/scripts/agent-runner.mjs
```

Leave that window open and email yourself a test. When it works, make it
survive a reboot with a launchd agent at
`~/Library/LaunchAgents/in.caclasses.agent-runner.plist` — `RunAtLoad` and
`KeepAlive` both true, `AGENT_RUNNER_KEY` in `EnvironmentVariables`.

Also turn off **System Settings → Lock Screen → Turn display off** sleeping the
machine, or set `caffeinate -s`. A sleeping laptop polls nothing.

## 4 · What it is allowed to do

By default it can **read, search, edit and write files**, and run
`git status/diff/log/show` and `npx tsc --noEmit`. It cannot run other
commands, install anything, touch the database, push, deploy, or email anyone.

If a job needs more, it stops and replies with a line starting
`NEEDS PERMISSION:` telling you what it wanted. You then do that bit yourself,
or re-send with more detail.

To lift the limits entirely, start the runner with `AGENT_POWER=full`. Understand
what that means before you do: **the email address becomes equivalent to your
terminal**, on the machine that holds your tax returns, your Zoho tokens and
your Supabase keys. A passphrase travels in plaintext through mail servers.

## 5 · Turn it on

```sql
update site_settings set value = 'on' where key = 'agent_email_enabled';
```

To stop everything instantly, set it back to `off`. That halts the inbox **and**
the runner — queued work stops too, not just new mail.

---

## Writing a job

Subject and body are joined, so either will do. The passphrase must appear in
one of them and is stripped before the instruction is used.

> **To:** do@caparveensharma.com
> **Subject:** correct horse battery — fix the toppers cron
>
> The toppers announcement went out twice on the 29th. Find out why and fix it.

You get a "Queued" acknowledgement immediately, and the result when it finishes.

## Guards that are already in place

- **Four checks** before anything is queued: switch on, passphrase present,
  Mailgun's SPF **and** DKIM verdicts both `pass`, sender on the allowed list.
- **A refused order gets no reply.** Telling a stranger which check they failed
  is telling them how to pass it. You are alerted instead, and only when the
  refusal looks like it might have been you.
- **One job at a time**, in order, thirty-minute cap each.
- **A dead runner releases its job** after fifteen minutes without a heartbeat.
- **Every attempt is recorded** in `agent_jobs`, refusals included.

## If something looks wrong

```sql
select created_at, status, refused_why, from_email, left(subject,60)
from agent_jobs order by created_at desc limit 20;
```

An unexpected `refused` row from an address that is not yours means somebody
has found the address. Change `AGENT_EMAIL_SECRET`, or set the switch to `off`.
