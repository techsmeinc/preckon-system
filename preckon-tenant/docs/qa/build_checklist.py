# Render the QA sheet as a working checklist — one self-contained HTML file.
#
# Generated from the same CSV the sheet is, so the two cannot drift: run
# build_qa.py, then this. State lives in the browser's localStorage keyed by
# case ID, and Export CSV writes the sheet back out with whatever has been
# recorded, so a tester's afternoon does not end in a file nobody else has.
#
#   python build_checklist.py preckon-qa-results.csv checklist.html "5 August 2026"
import csv, json, sys, html

src, out = sys.argv[1], sys.argv[2]
stamp = sys.argv[3] if len(sys.argv) > 3 else ""

rows = list(csv.DictReader(open(src, encoding="utf-8-sig")))

# Cases added after the first pass — the tester needs to find them without
# reading all 192, so they are flagged rather than merely appended.
NEW = {f"T-{n}" for n in range(89, 135)} | {"D-12", "D-13", "D-15"}

cases = [{
    "id": r["ID"], "plane": r["Plane"], "area": r["Area"], "name": r["Test Case"],
    "steps": r["Steps"], "expect": r["Expected"], "pri": r["Priority"],
    "result": (r["Result"] or "").strip().upper(), "note": r["Notes"],
    "new": r["ID"] in NEW,
} for r in rows]

DATA = json.dumps(cases, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preckon — QA checklist</title>
<style>
/* ── tokens ───────────────────────────────────────────────────────────────
   The palette is the product's own: the blues are the exact inks the exported
   bill and programme print in (#1F4E79 title, #31708E header band), so the
   checklist and the thing it checks look like they come from one place. The
   neutrals carry a slight blue bias for the same reason — a pure grey beside
   these blues reads as unrelated. Status colours are deliberately outside that
   family: a result must never be mistaken for chrome. */
:root{
  --paper:#F5F8F9; --card:#FFFFFF; --sunken:#EDF2F4;
  --ink:#0F1C24; --ink-2:#3D5260; --ink-3:#6C818D;
  --line:#D9E3E8; --line-2:#C3D2D9;
  --accent:#1F4E79; --accent-2:#31708E; --accent-soft:#E4EDF3;
  --pass:#1B7F4B; --fail:#B3261E; --blocked:#A15C00; --untested:#96A6AF;
  --pass-bg:#E6F3EC; --fail-bg:#FBE9E7; --blocked-bg:#FBF0DF; --untested-bg:#EDF2F4;
  --on-accent:#FFFFFF;
  --shadow:0 1px 2px rgba(15,28,36,.06), 0 8px 24px rgba(15,28,36,.05);
  --sans:ui-sans-serif,system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,"Cascadia Mono","Cascadia Code",Consolas,"SF Mono",Menlo,monospace;
}
@media (prefers-color-scheme: dark){
  :root{
    --paper:#0C1418; --card:#121D23; --sunken:#0A1216;
    --ink:#E7EEF1; --ink-2:#A9BCC5; --ink-3:#7A8F9A;
    --line:#22333C; --line-2:#2E434E;
    --accent:#7FB4D8; --accent-2:#5C93B5; --accent-soft:#16262F;
    --pass:#5FD39A; --fail:#F0837B; --blocked:#E0A85A; --untested:#728690;
    --pass-bg:#10241B; --fail-bg:#2A1614; --blocked-bg:#28200F; --untested-bg:#16232A;
    --on-accent:#08141A;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.3);
  }
}
:root[data-theme="dark"]{
  --paper:#0C1418; --card:#121D23; --sunken:#0A1216;
  --ink:#E7EEF1; --ink-2:#A9BCC5; --ink-3:#7A8F9A;
  --line:#22333C; --line-2:#2E434E;
  --accent:#7FB4D8; --accent-2:#5C93B5; --accent-soft:#16262F;
  --pass:#5FD39A; --fail:#F0837B; --blocked:#E0A85A; --untested:#728690;
  --pass-bg:#10241B; --fail-bg:#2A1614; --blocked-bg:#28200F; --untested-bg:#16232A;
    --on-accent:#08141A;
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.3);
}
:root[data-theme="light"]{
  --paper:#F5F8F9; --card:#FFFFFF; --sunken:#EDF2F4;
  --ink:#0F1C24; --ink-2:#3D5260; --ink-3:#6C818D;
  --line:#D9E3E8; --line-2:#C3D2D9;
  --accent:#1F4E79; --accent-2:#31708E; --accent-soft:#E4EDF3;
  --pass:#1B7F4B; --fail:#B3261E; --blocked:#A15C00; --untested:#96A6AF;
  --pass-bg:#E6F3EC; --fail-bg:#FBE9E7; --blocked-bg:#FBF0DF; --untested-bg:#EDF2F4;
  --on-accent:#FFFFFF;
  --shadow:0 1px 2px rgba(15,28,36,.06), 0 8px 24px rgba(15,28,36,.05);
}

*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{background:var(--paper); color:var(--ink); font-family:var(--sans);
  font-size:15px; line-height:1.5; -webkit-font-smoothing:antialiased;}
.wrap{max-width:1180px; margin:0 auto; padding:0 20px 96px;}

/* ── masthead ─────────────────────────────────────────────────────────── */
.mast{padding:38px 0 22px; display:flex; align-items:flex-end; gap:24px; flex-wrap:wrap;}
.mast h1{margin:0; font-size:29px; line-height:1.15; letter-spacing:-.02em; font-weight:650;
  text-wrap:balance;}
.eyebrow{font-family:var(--mono); font-size:11px; letter-spacing:.16em; text-transform:uppercase;
  color:var(--accent-2); margin:0 0 8px;}
.mast p{margin:8px 0 0; color:var(--ink-2); max-width:62ch;}
.mast .grow{flex:1 1 320px;}
.theme{font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase;
  background:transparent; color:var(--ink-3); border:1px solid var(--line);
  border-radius:999px; padding:7px 13px; cursor:pointer;}
.theme:hover{border-color:var(--line-2); color:var(--ink);}

/* ── progress ─────────────────────────────────────────────────────────── */
.summary{display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px;
  margin:6px 0 18px;}
.tile{background:var(--card); border:1px solid var(--line); border-radius:12px;
  padding:13px 15px; box-shadow:var(--shadow); position:relative; overflow:hidden;}
.tile::before{content:""; position:absolute; inset:0 auto 0 0; width:3px; background:var(--edge,var(--line-2));}
.tile .k{font-family:var(--mono); font-size:10px; letter-spacing:.13em; text-transform:uppercase;
  color:var(--ink-3);}
.tile .v{font-size:26px; font-weight:650; letter-spacing:-.02em; font-variant-numeric:tabular-nums;
  margin-top:3px;}
.tile.pass{--edge:var(--pass);} .tile.pass .v{color:var(--pass);}
.tile.fail{--edge:var(--fail);} .tile.fail .v{color:var(--fail);}
.tile.blocked{--edge:var(--blocked);} .tile.blocked .v{color:var(--blocked);}
.tile.untested{--edge:var(--untested);} .tile.untested .v{color:var(--ink-2);}
.tile.total{--edge:var(--accent);}

.bar{height:8px; border-radius:999px; background:var(--sunken); overflow:hidden;
  display:flex; border:1px solid var(--line); margin-bottom:20px;}
.bar i{display:block; height:100%;}
.bar .p{background:var(--pass);} .bar .f{background:var(--fail);} .bar .b{background:var(--blocked);}

/* ── controls ─────────────────────────────────────────────────────────── */
.controls{position:sticky; top:0; z-index:20; background:var(--paper);
  background:color-mix(in srgb, var(--paper) 88%, transparent);
  backdrop-filter:blur(10px); border-bottom:1px solid var(--line);
  padding:12px 0; margin-bottom:6px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;}
.seg{display:inline-flex; background:var(--sunken); border:1px solid var(--line);
  border-radius:9px; padding:2px; gap:2px;}
.seg button{font-family:var(--sans); font-size:12.5px; font-weight:550; color:var(--ink-2);
  background:transparent; border:0; border-radius:7px; padding:6px 11px; cursor:pointer;
  white-space:nowrap;}
.seg button:hover{color:var(--ink);}
.seg button[aria-pressed="true"]{background:var(--card); color:var(--ink); box-shadow:var(--shadow);}
.seg button .n{font-family:var(--mono); font-size:10.5px; color:var(--ink-3); margin-inline-start:5px;}
.find{flex:1 1 200px; min-width:160px;}
.find input{width:100%; font-family:var(--sans); font-size:13.5px; color:var(--ink);
  background:var(--card); border:1px solid var(--line); border-radius:9px; padding:8px 12px;}
.find input:focus{outline:none; border-color:var(--accent-2);
  box-shadow:0 0 0 3px var(--accent-soft);}
.act{font-family:var(--sans); font-size:12.5px; font-weight:600; color:var(--ink);
  background:var(--card); border:1px solid var(--line); border-radius:9px; padding:8px 13px;
  cursor:pointer;}
.act:hover{border-color:var(--line-2);}
.act.pri{background:var(--accent); border-color:var(--accent); color:var(--on-accent);}
.act:focus-visible,.seg button:focus-visible,.theme:focus-visible,.row-head:focus-visible{
  outline:2px solid var(--accent-2); outline-offset:2px;}

/* ── groups + rows ────────────────────────────────────────────────────── */
.group{margin-top:26px;}
.group > h2{margin:0 0 9px; font-family:var(--mono); font-size:11px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--ink-3); display:flex; align-items:center; gap:10px;}
.group > h2::after{content:""; flex:1; height:1px; background:var(--line);}

.row{background:var(--card); border:1px solid var(--line); border-radius:11px;
  margin-bottom:7px; box-shadow:var(--shadow); overflow:hidden;
  border-inline-start:3px solid var(--untested);}
.row[data-r="PASS"]{border-inline-start-color:var(--pass);}
.row[data-r="FAIL"]{border-inline-start-color:var(--fail);}
.row[data-r="BLOCKED"]{border-inline-start-color:var(--blocked);}

.row-head{display:grid; grid-template-columns:74px 1fr auto auto; gap:12px; align-items:center;
  width:100%; padding:11px 14px; background:transparent; border:0; cursor:pointer; text-align:start;
  font-family:inherit; color:inherit;}
.row-head:hover{background:var(--sunken);}
.cid{font-family:var(--mono); font-size:11.5px; color:var(--ink-3); letter-spacing:.02em;}
.cname{font-size:14px; font-weight:550; line-height:1.35;}
.cname .newflag{font-family:var(--mono); font-size:9px; letter-spacing:.1em; text-transform:uppercase;
  color:var(--accent); background:var(--accent-soft); border-radius:4px; padding:2px 5px;
  margin-inline-start:8px; vertical-align:1px;}
.carea{font-size:11.5px; color:var(--ink-3); margin-top:2px;}
.pri{font-family:var(--mono); font-size:10px; letter-spacing:.08em; color:var(--ink-3);
  border:1px solid var(--line); border-radius:5px; padding:2px 6px;}
.pri.P1{color:var(--accent); border-color:var(--accent); font-weight:700;}
.state{font-family:var(--mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase;
  border-radius:999px; padding:4px 9px; white-space:nowrap;
  background:var(--untested-bg); color:var(--ink-3);}
.row[data-r="PASS"] .state{background:var(--pass-bg); color:var(--pass);}
.row[data-r="FAIL"] .state{background:var(--fail-bg); color:var(--fail);}
.row[data-r="BLOCKED"] .state{background:var(--blocked-bg); color:var(--blocked);}

.row-body{display:none; padding:2px 14px 14px; border-top:1px solid var(--line);}
.row.open .row-body{display:block;}
.pair{display:grid; grid-template-columns:88px 1fr; gap:6px 14px; margin:12px 0;
  font-size:13.5px; line-height:1.55;}
.pair dt{font-family:var(--mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase;
  color:var(--ink-3); padding-top:3px;}
.pair dd{margin:0; color:var(--ink-2);}
.pair dd strong{color:var(--ink); font-weight:600;}
.verdict{display:flex; gap:7px; flex-wrap:wrap; align-items:center; margin-top:4px;}
.verdict button{font-family:var(--sans); font-size:12.5px; font-weight:600; cursor:pointer;
  border-radius:8px; padding:7px 14px; border:1px solid var(--line); background:var(--card);
  color:var(--ink-2);}
.verdict button:hover{border-color:var(--line-2); color:var(--ink);}
.verdict button[aria-pressed="true"][data-v="PASS"]{background:var(--pass-bg); border-color:var(--pass); color:var(--pass);}
.verdict button[aria-pressed="true"][data-v="FAIL"]{background:var(--fail-bg); border-color:var(--fail); color:var(--fail);}
.verdict button[aria-pressed="true"][data-v="BLOCKED"]{background:var(--blocked-bg); border-color:var(--blocked); color:var(--blocked);}
.verdict .clear{margin-inline-start:auto; font-weight:500; color:var(--ink-3);}
.row-body textarea{width:100%; margin-top:11px; min-height:56px; resize:vertical;
  font-family:var(--sans); font-size:13px; color:var(--ink); background:var(--sunken);
  border:1px solid var(--line); border-radius:9px; padding:9px 11px;}
.row-body textarea:focus{outline:none; border-color:var(--accent-2); box-shadow:0 0 0 3px var(--accent-soft);}

.empty{text-align:center; padding:60px 20px; color:var(--ink-3);}
footer{margin-top:40px; padding-top:18px; border-top:1px solid var(--line);
  font-size:12.5px; color:var(--ink-3); display:flex; gap:14px; flex-wrap:wrap;}

@media (max-width:720px){
  .row-head{grid-template-columns:1fr auto; gap:8px 10px;}
  .cid{grid-column:1/-1;}
  .pri{display:none;}
  .pair{grid-template-columns:1fr;}
  .pair dt{padding-top:8px;}
}
@media print{
  .controls,.theme,.verdict,.act{display:none !important;}
  .row-body{display:block !important;}
  body{background:#fff;}
  .row{break-inside:avoid; box-shadow:none;}
}
@media (prefers-reduced-motion:no-preference){
  .row{transition:border-color .12s ease;}
}
</style>
</head>
<body>
<div class="wrap">

  <header class="mast">
    <div class="grow">
      <p class="eyebrow">Release verification</p>
      <h1>Preckon — QA checklist</h1>
      <p>__COUNT__ cases across the Host plane, the Tenant workspace and deployment.
         Results save in this browser as you go; Export CSV writes the sheet back out.</p>
    </div>
    <button class="theme" id="theme" type="button">Theme</button>
  </header>

  <div class="summary" id="summary"></div>
  <div class="bar" id="bar"></div>

  <div class="controls">
    <div class="seg" id="f-plane"></div>
    <div class="seg" id="f-result"></div>
    <div class="seg" id="f-pri"></div>
    <div class="find"><input id="q" type="search" placeholder="Search cases, steps, expected results…" aria-label="Search"></div>
    <button class="act" id="expand" type="button">Expand all</button>
    <button class="act pri" id="export" type="button">Export CSV</button>
    <button class="act" id="reset" type="button">Reset</button>
  </div>

  <main id="list"></main>

  <footer>
    <span>Generated __STAMP__</span>
    <span>Untested cases are untested — nothing here is marked passed that was not seen to pass.</span>
  </footer>
</div>

<script>
const CASES = __DATA__;
const KEY = "preckon-qa-v2";
const RESULTS = ["PASS","FAIL","BLOCKED"];

/* Seeded from the sheet, then overlaid with whatever this browser has recorded,
   so re-opening the file never silently discards an afternoon's testing. */
let state = {};
for (const c of CASES) state[c.id] = { r: c.result || "", n: c.note || "" };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  for (const id in saved) if (state[id]) state[id] = { ...state[id], ...saved[id] };
} catch { /* corrupt or blocked storage — fall back to the sheet */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };

const filters = { plane: "all", result: "all", pri: "all", q: "" };
const el = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

const planes = ["all", ...new Set(CASES.map((c) => c.plane))];
const pris   = ["all", ...new Set(CASES.map((c) => c.pri))].sort();

function matches(c) {
  if (filters.plane !== "all" && c.plane !== filters.plane) return false;
  if (filters.pri !== "all" && c.pri !== filters.pri) return false;
  const r = state[c.id].r;
  if (filters.result === "untested" ? r : filters.result !== "all" && r !== filters.result) return false;
  if (filters.q) {
    const hay = (c.id + " " + c.name + " " + c.area + " " + c.steps + " " + c.expect).toLowerCase();
    if (!hay.includes(filters.q)) return false;
  }
  return true;
}

function counts(list) {
  const n = { total: list.length, PASS: 0, FAIL: 0, BLOCKED: 0, untested: 0 };
  for (const c of list) {
    const r = state[c.id].r;
    if (RESULTS.includes(r)) n[r]++; else n.untested++;
  }
  return n;
}

function renderSeg(node, options, active, onPick, label) {
  node.setAttribute("role", "group");
  node.setAttribute("aria-label", label);
  node.innerHTML = options.map((o) =>
    `<button type="button" data-v="${esc(o.v)}" aria-pressed="${o.v === active}">${esc(o.t)}` +
    (o.n === undefined ? "" : `<span class="n">${o.n}</span>`) + `</button>`
  ).join("");
  node.onclick = (e) => {
    const b = e.target.closest("button");
    if (b) onPick(b.dataset.v);
  };
}

function renderControls() {
  renderSeg(el("f-plane"), planes.map((p) => ({
    v: p, t: p === "all" ? "All planes" : p,
    n: p === "all" ? CASES.length : CASES.filter((c) => c.plane === p).length,
  })), filters.plane, (v) => { filters.plane = v; render(); }, "Filter by plane");

  const scope = CASES.filter((c) => filters.plane === "all" || c.plane === filters.plane);
  const n = counts(scope);
  renderSeg(el("f-result"), [
    { v: "all", t: "All", n: n.total },
    { v: "untested", t: "Untested", n: n.untested },
    { v: "PASS", t: "Passed", n: n.PASS },
    { v: "FAIL", t: "Failed", n: n.FAIL },
    { v: "BLOCKED", t: "Blocked", n: n.BLOCKED },
  ], filters.result, (v) => { filters.result = v; render(); }, "Filter by result");

  renderSeg(el("f-pri"), pris.map((p) => ({ v: p, t: p === "all" ? "Any priority" : p })),
    filters.pri, (v) => { filters.pri = v; render(); }, "Filter by priority");
}

function renderSummary() {
  const scope = CASES.filter((c) => filters.plane === "all" || c.plane === filters.plane);
  const n = counts(scope);
  el("summary").innerHTML = [
    ["total", "Cases", n.total], ["pass", "Passed", n.PASS], ["fail", "Failed", n.FAIL],
    ["blocked", "Blocked", n.BLOCKED], ["untested", "Untested", n.untested],
  ].map(([k, label, v]) => `<div class="tile ${k}"><div class="k">${label}</div><div class="v">${v}</div></div>`).join("");
  const pct = (x) => (n.total ? (x / n.total) * 100 : 0);
  el("bar").innerHTML =
    `<i class="p" style="width:${pct(n.PASS)}%"></i>` +
    `<i class="f" style="width:${pct(n.FAIL)}%"></i>` +
    `<i class="b" style="width:${pct(n.BLOCKED)}%"></i>`;
}

function rowHtml(c) {
  const s = state[c.id];
  const r = RESULTS.includes(s.r) ? s.r : "";
  return `<article class="row" data-id="${c.id}" data-r="${r}">
    <button class="row-head" type="button" aria-expanded="false">
      <span class="cid">${esc(c.id)}</span>
      <span>
        <span class="cname">${esc(c.name)}${c.new ? '<span class="newflag">New</span>' : ""}</span>
        <span class="carea">${esc(c.plane)} &middot; ${esc(c.area)}</span>
      </span>
      <span class="pri ${esc(c.pri)}">${esc(c.pri)}</span>
      <span class="state">${r || "Untested"}</span>
    </button>
    <div class="row-body">
      <dl class="pair">
        <dt>Steps</dt><dd>${esc(c.steps)}</dd>
        <dt>Expected</dt><dd><strong>${esc(c.expect)}</strong></dd>
      </dl>
      <div class="verdict">
        ${RESULTS.map((v) => `<button type="button" data-v="${v}" aria-pressed="${r === v}">${v[0] + v.slice(1).toLowerCase()}</button>`).join("")}
        <button type="button" class="clear" data-v="">Clear</button>
      </div>
      <textarea placeholder="Notes — what you saw, and where">${esc(s.n)}</textarea>
    </div>
  </article>`;
}

function render() {
  renderControls();
  renderSummary();
  const visible = CASES.filter(matches);
  if (!visible.length) {
    el("list").innerHTML = `<p class="empty">No case matches that filter.</p>`;
    return;
  }
  // Grouped by area within plane — the order a tester works in, rather than by ID.
  const groups = [];
  for (const c of visible) {
    const key = c.plane + " / " + c.area;
    const g = groups.find((x) => x.key === key) || (groups.push({ key, items: [] }), groups[groups.length - 1]);
    g.items.push(c);
  }
  el("list").innerHTML = groups.map((g) =>
    `<section class="group"><h2>${esc(g.key)}</h2>${g.items.map(rowHtml).join("")}</section>`
  ).join("");
}

/* One delegated listener for the whole list — 192 rows do not each need three. */
el("list").addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  if (!row) return;
  const head = e.target.closest(".row-head");
  if (head) {
    const open = row.classList.toggle("open");
    head.setAttribute("aria-expanded", String(open));
    return;
  }
  const v = e.target.closest(".verdict button");
  if (v) {
    const id = row.dataset.id;
    state[id].r = v.dataset.v;
    save();
    row.dataset.r = v.dataset.v;
    row.querySelector(".state").textContent = v.dataset.v || "Untested";
    row.querySelectorAll(".verdict button[data-v]").forEach((b) =>
      b.setAttribute("aria-pressed", String(!!b.dataset.v && b.dataset.v === v.dataset.v)));
    renderSummary();
    renderControls();
  }
});
el("list").addEventListener("input", (e) => {
  if (e.target.tagName !== "TEXTAREA") return;
  const row = e.target.closest(".row");
  state[row.dataset.id].n = e.target.value;
  save();
});

el("q").addEventListener("input", (e) => { filters.q = e.target.value.trim().toLowerCase(); render(); });

el("expand").addEventListener("click", () => {
  const rows = [...document.querySelectorAll(".row")];
  const open = !rows.every((r) => r.classList.contains("open"));
  rows.forEach((r) => {
    r.classList.toggle("open", open);
    r.querySelector(".row-head").setAttribute("aria-expanded", String(open));
  });
  el("expand").textContent = open ? "Collapse all" : "Expand all";
});

el("export").addEventListener("click", () => {
  const q = (s) => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
  const lines = [["ID","Plane","Area","Test Case","Steps","Expected","Priority","Result","Notes"].join(",")];
  for (const c of CASES) {
    const s = state[c.id];
    lines.push([c.id, c.plane, c.area, c.name, c.steps, c.expect, c.pri, s.r, s.n].map(q).join(","));
  }
  // The BOM matters: without it Excel on Windows reads UTF-8 as the ANSI
  // codepage, which is how the last sheet filled up with mojibake.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "preckon-qa-results.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});

el("reset").addEventListener("click", () => {
  if (!confirm("Clear every result and note recorded in this browser, and go back to the sheet as generated?")) return;
  try { localStorage.removeItem(KEY); } catch {}
  state = {};
  for (const c of CASES) state[c.id] = { r: c.result || "", n: c.note || "" };
  render();
});

el("theme").addEventListener("click", () => {
  const now = document.documentElement.getAttribute("data-theme");
  const dark = now ? now === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", dark ? "light" : "dark");
});

render();
</script>
</body>
</html>
"""

page = (TEMPLATE
        .replace("__DATA__", DATA)
        .replace("__COUNT__", str(len(cases)))
        .replace("__STAMP__", html.escape(stamp) if stamp else "from the current sheet"))

open(out, "w", encoding="utf-8").write(page)
n_new = sum(1 for c in cases if c["new"])
print(f"{len(cases)} cases ({n_new} new) -> {out}  [{len(page)/1024:.0f} KB]")
