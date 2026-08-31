# Call Bridge

**The phone becomes the IVR.** One employee answers every call on one SIM. The
portal already turns a call event into a ticket at `/api/calls/webhook`, and
already checks a key. All that was ever bought from the telephony provider was
something to POST that event. This is that something, and it costs nothing to
run.

Replaces roughly **₹15,000 a month** of cloud telephony with an APK.

---

## What it does

Every call on the handset becomes a portal ticket, exactly as the provider's
webhook does today:

| On the phone | What the portal does |
|---|---|
| Missed call | Opens a **high-priority** ticket, "Missed call from …" |
| Rejected call | Same — the caller did not get through, so somebody rings back |
| Answered incoming | Logs on the caller's open ticket, or opens one |
| Outgoing call | Logs on the open ticket — the callback is recorded (can be switched off) |

The caller is matched against `profiles` and then `leads`, so the ticket carries
the student's name rather than a bare number. None of that is new — it is the
existing endpoint, unchanged.

## How it stays honest

**Two paths, on purpose.** A manifest receiver on `PHONE_STATE` schedules a
sweep eight and thirty seconds after a call ends, so the usual case is reported
within seconds. A **quarter-hourly alarm** sweeps again regardless. The receiver
gives immediacy; the alarm gives completeness, and completeness is the point —
the one failure this whole system exists to prevent is a missed call nobody
rings back.

**The call log is the source of truth, not the broadcast.** `PHONE_STATE` tells
you a call ended. It does not reliably say whether it was answered, and on
several manufacturers' builds it carries no number at all. `CallLog.Calls` has
both, a second or two later.

**A watermark, so nothing is sent twice.** The sweep reads only rows newer than
the last one reported. On a first run the watermark is set to *now* — sweeping a
year of history would open a ticket for every call the handset has ever taken.

**A queue, so nothing is lost.** A send that fails is written back and retried on
the next sweep, in order, capped at 200 so a week offline cannot grow without
bound. The watermark advances before sending, deliberately: a call sent twice is
a duplicate line on a ticket, a call stamped and never sent is one nobody rings
back, and the queue makes the first outcome the only realistic one.

**No dependencies.** Not one. The first cut used `androidx.appcompat`, which
drags a Kotlin standard library behind it and would not merge. Nothing here
needs it — six stock widgets and the platform theme. The APK is **21 KB**.

## Privacy

The key travels in the `x-webhook-key` header, not the query string, so a
caller's number never lands in a proxy log. Only the last ten digits are sent,
and anything that is not a ten-digit number — withheld, private, international —
is dropped on the phone rather than posted and discarded at the far end.

---

## Building it

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
cd mobile/callbridge && ./gradlew assembleRelease
```

Output: `app/build/outputs/apk/release/app-release.apk`.

**Signed with the company key, not the debug key** — read from
`mobile/android/keystore.properties`, the same one the Play app uploads with.
That file is not in git; copy it from `~/Keystores/READ-ME-KEYSTORE-DETAILS.txt`
on any machine that builds. Without it the release comes out unsigned and fails
loudly at install, which is the right way round.

Debug signing was the original choice and it was wrong on two counts. Google's
developer-verification deadline of **30 September 2026** registers package name
and signing key as a PAIR, and `CN=Android Debug` is the key that ships with
every Android SDK on earth — not something anyone can register. And Android
refuses to update an app whose signature has changed, so a debug build put on
the phone today could not be replaced by a signed one later without
uninstalling it first and losing its settings.

| | |
|---|---|
| Package | `in.caclasses.callbridge` |
| Signer | `CN=Aldine Ventures Private Limited` |
| SHA-256 | `B8:59:86:92:E8:01:F1:C1:6D:5E:A8:37:9C:FB:2E:AA:BE:44:DB:3C:16:F8:3F:4E:E6:5F:DC:D3:05:AC:AA:4C` |

## Installing it

1. Copy the APK to the phone (email, cable, anything).
2. Settings → allow installing unknown apps from whichever app you used.
3. Open **Call Bridge** and grant the call log and phone permissions.
4. Fill in three fields:
   - **Portal address** — `https://caparveensharma.com`
   - **Webhook key** — Admin → Integrations → `IVR_WEBHOOK_KEY`
   - **This phone's number** — appears on the ticket as who took the call
5. Tick **Report calls to the portal**, then **Save**.
6. Press **Stop Android delaying this app** and allow it. Without this, Doze
   will defer the quarter-hourly sweep for hours on a phone sitting on a desk.
7. Press **Send a test**. A ticket should appear on the portal within seconds.

Then ring the phone from another number and let it go unanswered. A
high-priority ticket should appear.

## Running it alongside the provider

Leave the existing service running for two weeks and compare ticket counts.
With one agent they should match. Only then cancel — and check the notice
period first, since these contracts are usually annual.

## What it does not do

- **No IVR menu or greeting.** The phone simply rings. If a recorded greeting
  and a "press 1" menu are wanted, that needs a virtual number, and the cheapest
  route is a pay-per-minute DID with the menu built as one route in the portal.
- **No queue.** One phone, one call at a time. If it is busy or switched off the
  caller gets nothing — but the missed call still becomes a ticket the moment
  the phone sees it, and the portal can send an automatic WhatsApp on the back
  of that ticket, which is more than most IVRs do.
- **No recording.** Android 10 and later block third-party call recording. Where
  the manufacturer's own dialer records — Xiaomi, Samsung, Vivo, Realme — those
  files could be uploaded and attached to the ticket. Not built; say if it is
  wanted. If recording is turned on, announce it to callers.

## Why it is not on the Play Store

`READ_CALL_LOG` is a restricted permission there and needs a declared, approved
use case. Sideloading onto one handset avoids the question entirely.
