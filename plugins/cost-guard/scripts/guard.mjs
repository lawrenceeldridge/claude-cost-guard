#!/usr/bin/env node
// Cost Guard — portable spend guard for Claude Code.
//
// Modes:
//   gate        UserPromptSubmit hook: blocks / warns when over budget (reads no stdin it needs).
//   statusline  statusLine command: prints a live burn line (reads Claude Code's status JSON on stdin).
//   report      human-readable burn report (run manually).
//
// Data source: ccusage over local transcripts (no API key, no network beyond ccusage, no telemetry).
// Cross-platform: pure Node built-ins — runs on macOS, Linux, and Windows.
// Fails OPEN: any error results in "allow" so a fault can never lock you out of Claude Code.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Configuration — from plugin userConfig (CLAUDE_PLUGIN_OPTION_*), with
// COST_GUARD_* overrides for standalone use, and safe defaults.
// ---------------------------------------------------------------------------
function opt(key, def) {
  const K = key.toUpperCase();
  const env = process.env;
  const v =
    env[`CLAUDE_PLUGIN_OPTION_${key}`] ??
    env[`CLAUDE_PLUGIN_OPTION_${K}`] ??
    env[`COST_GUARD_${K}`];
  return v === undefined || v === "" ? def : v;
}
const MONTHLY_TARGET = num(opt("monthly_target", 4000), 4000);
const WORKING_DAYS = num(opt("working_days_per_month", 21), 21);
const WARN_PCT = num(opt("warn_pct", 80), 80);
const HARD_BLOCK = String(opt("hard_block", "true")).toLowerCase() !== "false";
const CACHE_TTL = num(opt("cache_ttl", 120), 120);
const CCUSAGE_SPEC = opt("ccusage_spec", "ccusage@latest"); // pin here for reproducibility

const DAILY_BUDGET = WORKING_DAYS > 0 ? MONTHLY_TARGET / WORKING_DAYS : MONTHLY_TARGET;

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// Paths — writable state lives in CLAUDE_PLUGIN_DATA (falls back to a temp dir
// when run outside the plugin, e.g. during tests). Never write to PLUGIN_ROOT.
// ---------------------------------------------------------------------------
const DATA_DIR = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), "cost-guard");
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ignore */ }
const CACHE_FILE = path.join(DATA_DIR, "cache.json");

// ---------------------------------------------------------------------------
// Dates — local time, no external `date` binary.
// ---------------------------------------------------------------------------
function isoDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const NOW = new Date();
const TODAY_ISO = isoDay(NOW);
const TODAY_COMPACT = TODAY_ISO.replaceAll("-", "");
const MONTH_START_COMPACT = `${NOW.getFullYear()}${String(NOW.getMonth() + 1).padStart(2, "0")}01`;

// ---------------------------------------------------------------------------
// ccusage invocation — prefer a ccusage on PATH, else `npx -y <spec>`.
// shell:true only on Windows so .cmd shims resolve. Returns stdout or null.
// ---------------------------------------------------------------------------
function runCcusage(args) {
  const win = process.platform === "win32";
  const attempts = [
    ["ccusage", args],
    ["npx", ["-y", CCUSAGE_SPEC, ...args]],
  ];
  for (const [cmd, a] of attempts) {
    try {
      const r = spawnSync(cmd, a, {
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 64 * 1024 * 1024,
        shell: win,
      });
      if (r.status === 0 && r.stdout) return r.stdout;
    } catch { /* try next */ }
  }
  return null;
}

function fetchMonthRows() {
  const out = runCcusage(["daily", "--json", "--since", MONTH_START_COMPACT, "--until", TODAY_COMPACT]);
  if (!out) return [];
  try {
    const d = JSON.parse(out);
    return Array.isArray(d?.daily) ? d.daily : [];
  } catch {
    return [];
  }
}

// Cached {today, mtd}. Fail-open: on any trouble, returns zeros (never blocks).
function compute() {
  try {
    const st = fs.statSync(CACHE_FILE);
    if ((Date.now() - st.mtimeMs) / 1000 < CACHE_TTL) {
      const c = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      if (Number.isFinite(c?.today) && Number.isFinite(c?.mtd)) return { today: c.today, mtd: c.mtd };
    }
  } catch { /* stale/absent cache — recompute */ }

  let today = 0, mtd = 0;
  for (const r of fetchMonthRows()) {
    const c = num(r?.totalCost, 0);
    mtd += c;
    if (r?.period === TODAY_ISO) today += c;
  }
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ today, mtd, at: Date.now() })); } catch { /* ignore */ }
  return { today, mtd };
}

function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

const pct = (val, of) => (of > 0 ? (val / of) * 100 : 0);
const usd = (n) => `$${n.toFixed(2)}`;
function flagFor(dpct, mpct) {
  if (dpct >= 100 || mpct >= 100) return "🛑";
  if (dpct >= WARN_PCT || mpct >= WARN_PCT) return "⚠️";
  return "🟢";
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------
function modeGate() {
  const overrideFile = path.join(DATA_DIR, `.override-${TODAY_ISO}`);
  if (process.env.COST_GUARD_OVERRIDE === "1" || safeExists(overrideFile)) return allow();

  const { today, mtd } = compute();
  const dpct = pct(today, DAILY_BUDGET);
  const mpct = pct(mtd, MONTHLY_TARGET);

  if (HARD_BLOCK && (today >= DAILY_BUDGET || mtd >= MONTHLY_TARGET)) {
    const reason =
      `🛑 Cost Guard — budget reached, prompt blocked.\n` +
      `Today: ${usd(today)} of ${usd(DAILY_BUDGET)} daily budget (${dpct.toFixed(0)}%).  ` +
      `Month-to-date: ${usd(mtd)} of ${usd(MONTHLY_TARGET)} target (${mpct.toFixed(0)}%).\n` +
      `To continue anyway today: create the file ${overrideFile}  (or set COST_GUARD_OVERRIDE=1).\n` +
      `To change limits or switch to warn-only, reconfigure the cost-guard plugin (hard_block=false).`;
    process.stdout.write(JSON.stringify({ decision: "block", reason }));
    return process.exit(0);
  }

  if (dpct >= WARN_PCT || mpct >= WARN_PCT) {
    const ctx =
      `Cost Guard notice: today's Claude Code spend is ${usd(today)} ` +
      `(${dpct.toFixed(0)}% of the ${usd(DAILY_BUDGET)}/day budget); ` +
      `month-to-date ${usd(mtd)} / ${usd(MONTHLY_TARGET)}. Approaching the limit — be economical.`;
    process.stdout.write(JSON.stringify({ additionalContext: ctx }));
    return process.exit(0);
  }
  return allow();
}

function allow() { return process.exit(0); }

function safeExists(p) { try { return fs.existsSync(p); } catch { return false; } }

function modeStatusline() {
  let model = "?", sess = 0;
  try {
    const j = JSON.parse(readStdin());
    model = j?.model?.display_name ?? "?";
    sess = num(j?.cost?.total_cost_usd, 0);
  } catch { /* keep defaults */ }

  const { today, mtd } = compute();
  const dpct = pct(today, DAILY_BUDGET);
  const mpct = pct(mtd, MONTHLY_TARGET);
  const flag = flagFor(dpct, mpct);

  process.stdout.write(
    `${flag} [${model}] sess ${usd(sess)} · ` +
    `today ${usd(today)}/$${DAILY_BUDGET.toFixed(0)} (${dpct.toFixed(0)}%) · ` +
    `month $${mtd.toFixed(0)}/$${MONTHLY_TARGET.toFixed(0)} (${mpct.toFixed(0)}%)\n`
  );
  process.exit(0);
}

// Compact one-line snapshot with no session context (for the /cost-guard:status command).
function modeSnapshot() {
  const { today, mtd } = compute();
  const dpct = pct(today, DAILY_BUDGET);
  const mpct = pct(mtd, MONTHLY_TARGET);
  process.stdout.write(
    `${flagFor(dpct, mpct)} today ${usd(today)}/$${DAILY_BUDGET.toFixed(0)} (${dpct.toFixed(0)}%) · ` +
    `month $${mtd.toFixed(0)}/$${MONTHLY_TARGET.toFixed(0)} (${mpct.toFixed(0)}%)\n`
  );
  process.exit(0);
}

function bar(p) {
  const n = Math.max(0, Math.min(20, Math.round(p / 5)));
  return "█".repeat(n) + "░".repeat(20 - n);
}

function modeReport() {
  const rows = fetchMonthRows().slice().sort((a, b) => String(a.period).localeCompare(String(b.period)));
  const byDay = new Map(rows.map((r) => [r.period, num(r.totalCost, 0)]));
  const today = byDay.get(TODAY_ISO) || 0;
  let mtd = 0;
  for (const v of byDay.values()) mtd += v;
  const activeDays = [...byDay.values()].filter((v) => v > 0).length;
  const avgActive = activeDays ? mtd / activeDays : 0;

  const dim = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 0).getDate();
  const projMonth = NOW.getDate() ? (mtd / NOW.getDate()) * dim : mtd;

  const dpct = pct(today, DAILY_BUDGET);
  const mpct = pct(mtd, MONTHLY_TARGET);
  const sep = "-".repeat(54);
  const L = [];
  L.push("");
  L.push(`  Cost Guard — burn report (${TODAY_ISO})`);
  L.push(`  ${sep}`);
  L.push(`  Today         ${pad(usd(today))} / ${pad(usd(DAILY_BUDGET))}  ${bar(dpct)} ${dpct.toFixed(0).padStart(3)}%`);
  L.push(`  Month-to-date ${pad(usd(mtd))} / ${pad(usd(MONTHLY_TARGET))}  ${bar(mpct)} ${mpct.toFixed(0).padStart(3)}%`);
  L.push(`  ${sep}`);
  L.push(`  Active days this month : ${activeDays}`);
  L.push(`  Avg per active day     : ${usd(avgActive)}`);
  L.push(`  Projected month total  : ${usd(projMonth)}  (${pct(projMonth, MONTHLY_TARGET).toFixed(0)}% of target, calendar run-rate)`);
  L.push(`  Verdict                : ${projMonth <= MONTHLY_TARGET ? "on track" : "OVER — ease off or the month lands above target"}`);
  L.push(`  ${sep}`);
  L.push("  Last 7 days:");
  for (const r of rows.slice(-7)) {
    const c = byDay.get(r.period) || 0;
    L.push(`    ${r.period}  ${pad(usd(c))}  ${bar(pct(c, DAILY_BUDGET))} ${pct(c, DAILY_BUDGET).toFixed(0).padStart(3)}%`);
  }
  if (!rows.length) L.push("    (no ccusage data found)");
  L.push("");
  process.stdout.write(L.join("\n") + "\n");
  process.exit(0);
}

function pad(s) { return String(s).padStart(9); }

// ---------------------------------------------------------------------------
const mode = (process.argv[2] || "gate").toLowerCase();
try {
  if (mode === "gate") modeGate();
  else if (mode === "statusline") modeStatusline();
  else if (mode === "snapshot") modeSnapshot();
  else if (mode === "report") modeReport();
  else { process.stderr.write(`cost-guard: unknown mode '${mode}' (use gate|statusline|snapshot|report)\n`); process.exit(2); }
} catch (err) {
  // Absolute fail-open backstop: never block, never crash the caller.
  try { process.stderr.write(`cost-guard: ${err?.message || err}\n`); } catch { /* ignore */ }
  process.exit(0);
}
