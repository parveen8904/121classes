import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { computeEscalateAt, logTicketEvent, OPEN_STATUSES } from "@/lib/tickets";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// IVR / cloud-telephony → tickets. The founder's IVR provider (on 98100 12674)
// is pointed at this URL; every call event it POSTs becomes ticket activity:
//   • missed call            → new HIGH-priority ticket "Missed call from …"
//   • call, no open ticket   → new ticket so the outcome gets recorded
//   • call, open ticket      → logged on that ticket's activity trail
// Provider-agnostic: we accept GET or POST (JSON or form) and read the caller
// number / status / recording from the field names used by the common Indian
// providers (MyOperator, Exotel, Knowlarity, Servetel, Tata Smartflo, Ozonetel).

const CALLER_KEYS = [
  "caller_id_number", "caller_number", "caller_no", "callfrom", "call_from", "from",
  "caller", "customer_number", "cid", "mobile", "phone", "src", "callerid",
];
const STATUS_KEYS = ["call_status", "status", "dialstatus", "event", "type", "call_type", "disposition"];
const AGENT_KEYS = ["agent_number", "answered_agent", "agent", "answered_by", "user", "employee"];
const RECORDING_KEYS = ["recording_url", "recordingurl", "recording", "call_recording", "callrecordingurl"];

function firstOf(data: Record<string, string>, keys: string[]): string {
  for (const k of keys) if (data[k]) return data[k];
  return "";
}

// Flatten query params + JSON/form body into one lowercase-keyed map.
async function readPayload(req: NextRequest): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const add = (k: string, v: unknown) => {
    if (v === null || v === undefined) return;
    if (typeof v === "object") {
      // Nested payloads (e.g. {call: {caller_number: …}}) → both "call_caller_number" and "caller_number".
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) { add(`${k}_${k2}`, v2); add(k2, v2); }
      return;
    }
    const key = k.toLowerCase();
    if (!out[key]) out[key] = String(v);
  };
  new URL(req.url).searchParams.forEach((v, k) => add(k, v));
  if (req.method === "POST") {
    const ct = req.headers.get("content-type") || "";
    try {
      if (ct.includes("json")) {
        const j = await req.json();
        if (j && typeof j === "object") for (const [k, v] of Object.entries(j)) add(k, v);
      } else {
        const form = await req.formData();
        form.forEach((v, k) => add(k, typeof v === "string" ? v : ""));
      }
    } catch { /* some providers send empty bodies on test pings */ }
  }
  return out;
}

async function handle(req: NextRequest) {
  const key = await getSecret("IVR_WEBHOOK_KEY");
  if (!key) return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  if (new URL(req.url).searchParams.get("key") !== key) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const data = await readPayload(req);
  const rawCaller = firstOf(data, CALLER_KEYS);
  const digits = rawCaller.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return NextResponse.json({ ok: true, note: "no caller number — ignored (test ping?)" });

  const statusRaw = firstOf(data, STATUS_KEYS).toLowerCase();
  const missed = /miss|noanswer|no-answer|no_answer|unanswered|abandon|busy|failed/.test(statusRaw);
  const agent = firstOf(data, AGENT_KEYS);
  const recording = firstOf(data, RECORDING_KEYS);

  const svc = createServiceClient();

  // Who called? Match a student profile by the last 10 digits of their phone,
  // falling back to the imported-leads list.
  const { data: prof } = await svc
    .from("profiles")
    .select("id, full_name, email, phone")
    .like("phone", `%${digits}`)
    .limit(1)
    .maybeSingle();
  const { data: lead } = prof ? { data: null } : await svc
    .from("leads")
    .select("name, email")
    .eq("phone", digits)
    .limit(1)
    .maybeSingle();
  const who = (prof?.full_name as string) || (lead?.name as string) || digits;

  const line = [
    missed ? "📵 Missed IVR call" : "📞 IVR call",
    agent ? `answered by ${agent}` : null,
    statusRaw ? `(${statusRaw})` : null,
    recording ? `— recording: ${recording}` : null,
  ].filter(Boolean).join(" ");

  // Existing open ticket for this number → just log the call on it.
  const { data: open } = await svc
    .from("tickets")
    .select("id, ref")
    .like("student_phone", `%${digits}`)
    .in("status", OPEN_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (open) {
    await logTicketEvent(svc, open.id as string, { author_name: "IVR", kind: "call", body: line });
    return NextResponse.json({ ok: true, ticket: open.ref, action: "logged" });
  }

  // No open ticket → create one so the call is never lost.
  const priority = missed ? "high" : "normal";
  const { data: t } = await svc.from("tickets").insert({
    title: missed ? `Missed call from ${who}` : `Call from ${who}`,
    description: line,
    student_name: (prof?.full_name as string) || (lead?.name as string) || null,
    student_email: (prof?.email as string) || (lead?.email as string) || null,
    student_phone: digits,
    user_id: (prof?.id as string) || null,
    source: "phone",
    priority,
    status: "open",
    escalate_at: computeEscalateAt(priority),
  }).select("id, ref").maybeSingle();

  if (t) await logTicketEvent(svc, t.id as string, { author_name: "IVR", kind: "created", body: line });

  // Unknown caller (not a student, not an existing lead) → capture the number
  // as a lead too, so campaigns can reach them and future calls show a name.
  if (!prof && !lead) {
    await svc.from("leads").insert({ phone: digits, source: "phone", note: "called the IVR" }).select("id");
  }
  return NextResponse.json({ ok: true, ticket: t?.ref ?? null, action: "created" });
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest) { return handle(req); }
