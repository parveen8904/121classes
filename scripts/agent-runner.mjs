#!/usr/bin/env node
/**
 * THE RUNNER. It sits on his Mac and does the work an email asked for.
 *
 * Polls the portal, claims one job, runs Claude Code headless in the
 * repository, posts the answer back. Nothing listens on this machine — it only
 * ever dials out, so there is no port for anyone to find.
 *
 * ONE JOB AT A TIME, ON PURPOSE. Two sessions editing the same working tree
 * would fight over the same files. The queue is ordered; work waits its turn.
 *
 * ── WHAT IT IS ALLOWED TO DO, AND WHY IT IS NOT EVERYTHING ──────────────────
 *
 * The obvious way to build this is to let the session do anything, because in
 * headless mode a permission prompt has nobody to answer it and the run simply
 * stalls. That is also the reason not to: this address would then be able to
 * run any command on the machine that holds his tax returns, his accounting
 * tokens and his database keys — and the thing standing in front of it is a
 * passphrase that travels in plaintext through mail servers.
 *
 * So the default is a TOOL ALLOWLIST: read, search, edit, write, and the git
 * commands that only report. It covers most of what he actually asks for, and
 * a leaked passphrase buys an attacker an edit on a git branch rather than the
 * laptop. Anything outside the list is not refused silently — the session is
 * told to stop and say what it needed, and that lands in his inbox.
 *
 * Turning it up is one variable, and it is deliberately not the default:
 *   AGENT_POWER=full   — no restrictions at all. Equivalent to handing that
 *                        email address his terminal. Only with a passphrase he
 *                        has never sent anywhere, and never from a shared box.
 *
 * ── CONFIGURATION ───────────────────────────────────────────────────────────
 *   PORTAL   https://caparveensharma.com          (AGENT_PORTAL)
 *   KEY      AGENT_RUNNER_KEY, required
 *   REPO     the directory to work in             (AGENT_REPO)
 *   POLL     20s idle                             (AGENT_POLL_SECONDS)
 *   TIMEOUT  30 min per job                       (AGENT_TIMEOUT_MINUTES)
 *   POWER    "safe" (default) | "full"            (AGENT_POWER)
 */
import { spawn } from "node:child_process";
import os from "node:os";

const PORTAL = (process.env.AGENT_PORTAL || "https://caparveensharma.com").replace(/\/+$/, "");
const KEY = process.env.AGENT_RUNNER_KEY || "";
const REPO = process.env.AGENT_REPO || `${os.homedir()}/121classes`;
const POLL_MS = Number(process.env.AGENT_POLL_SECONDS || 20) * 1000;
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MINUTES || 30) * 60 * 1000;
const CLAUDE = process.env.AGENT_CLAUDE || `${os.homedir()}/.local/bin/claude`;
const RUNNER = process.env.AGENT_RUNNER_NAME || os.hostname();
const POWER = (process.env.AGENT_POWER || "safe").toLowerCase();

/** Read, search, edit — and only the git commands that report rather than change. */
const ALLOWED = [
  "Read", "Glob", "Grep", "Edit", "Write", "NotebookEdit", "TodoWrite",
  "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)",
  "Bash(npx tsc --noEmit)",
].join(" ");

/**
 * Prepended to every instruction so the session knows the shape of the room it
 * is in. Without this it discovers the limits by hitting them, one refused tool
 * at a time, and burns the run doing it.
 */
const SAFE_PREAMBLE =
  "You are running unattended, from an emailed instruction, with nobody watching. " +
  "You can read and search this repository, edit and write files, and run git status/diff/log/show " +
  "and `npx tsc --noEmit`. You CANNOT run any other command, install anything, touch the database, " +
  "push, deploy, or send anything to anybody. " +
  "If the task genuinely needs something outside that, STOP and end your reply with a line beginning " +
  "'NEEDS PERMISSION:' saying exactly what you needed and why — that goes straight to him. " +
  "Otherwise do the work, then finish with a short plain report: what you changed, which files, " +
  "and anything he should check. He will read it in an email, so no markdown headings and no preamble.\n\n" +
  "THE INSTRUCTION:\n";

if (!KEY) {
  console.error("AGENT_RUNNER_KEY is not set. Nothing will run without it.");
  process.exit(1);
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function api(payload) {
  const res = await fetch(`${PORTAL}/api/agent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-key": KEY },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`portal said ${res.status}`);
  return res.json();
}

/**
 * Run Claude Code once, headless, on this instruction.
 *
 * The instruction goes in on STDIN, never as an argument — an argument passes
 * through the shell's quoting rules and shows up in the process list, and text
 * that arrived in an email is exactly the wrong thing to put in either.
 */
function runClaude(instruction, onHeartbeat) {
  return new Promise((resolve) => {
    const args = POWER === "full"
      ? ["-p", "--dangerously-skip-permissions"]
      : ["-p", "--allowedTools", ALLOWED];
    const prompt = POWER === "full" ? instruction : SAFE_PREAMBLE + instruction;

    const child = spawn(CLAUDE, args, {
      cwd: REPO,
      env: { ...process.env, CI: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    let done = false;

    const beat = setInterval(() => onHeartbeat().catch(() => {}), 60_000);
    const timer = setTimeout(() => {
      if (done) return;
      err += `\n\n[runner] Stopped after ${TIMEOUT_MS / 60000} minutes without finishing.`;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });

    child.on("error", (e) => {
      if (done) return;
      done = true; clearInterval(beat); clearTimeout(timer);
      resolve({ ok: false, out, err: `could not start ${CLAUDE}: ${e.message}`, code: -1 });
    });

    child.on("close", (code) => {
      if (done) return;
      done = true; clearInterval(beat); clearTimeout(timer);
      resolve({ ok: code === 0, out: out.trim(), err: err.trim(), code });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function tick() {
  const { job, paused } = await api({ action: "claim", runner: RUNNER });
  if (paused) { log("paused — the switch is off"); return false; }
  if (!job) return false;

  log(`job ${job.id.slice(0, 8)} — ${String(job.subject || "").slice(0, 60)}`);
  const started = Date.now();
  const r = await runClaude(job.instruction, () => api({ action: "beat", id: job.id, runner: RUNNER }));
  const mins = Math.round((Date.now() - started) / 60000);
  log(`  ${r.ok ? "done" : "failed"} in ${mins} min (exit ${r.code})`);

  await api({
    action: "finish",
    id: job.id,
    ok: r.ok,
    // stderr goes back even on success — a warning he ought to see often lives
    // there, and dropping it loses the only clue about a job that "worked" and
    // did the wrong thing.
    result: r.out || "(the session returned nothing)",
    error: r.ok ? r.err.slice(0, 2000) : [r.err, r.out].filter(Boolean).join("\n\n"),
    exit_code: r.code,
  });
  return true;
}

log(`runner up · portal ${PORTAL} · repo ${REPO} · as ${RUNNER} · power ${POWER}`);
if (POWER === "full") log("WARNING: running with no restrictions. This email address can do anything you can.");
for (;;) {
  let worked = false;
  try {
    worked = await tick();
  } catch (e) {
    log("error:", e.message);
  }
  // Straight on to the next job if there was one — three queued jobs should
  // not cost a minute of waiting between them.
  await new Promise((r) => setTimeout(r, worked ? 1000 : POLL_MS));
}
