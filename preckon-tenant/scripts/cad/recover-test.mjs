// The assistant sometimes writes its tool call as prose instead of calling the
// tool. When it does, the panel must still show a sentence — not the wall of
// coordinates a user actually saw.
//
//   npx tsc src/lib/cad/agent.ts --outDir .t --module es2020 --target es2020 \
//     --moduleResolution bundler --skipLibCheck
//   node scripts/cad/recover-test.mjs ../../.t/agent.js
const { recoverFromText } = await import(process.argv[2] ?? "../../.t/agent.js");

const checks = [];
const ok = (what, pass) => checks.push([what, pass]);
const clean = (s) => !/[<{[]|parameter name|"kind"|"pts"/.test(s);

/* The exact shape reported: XML tool syntax leaking into the reply. */
{
  const leaked = `<parameter name="answer">The slab on layer 0 measures 84.05 m².</parameter>
<parameter name="marks">[{"kind":"area","pts":[{"x":-2234953,"y":-157757},{"x":-2126945,"y":-157757}],"label":"84.05 m²"}]</parameter>`;
  const r = recoverFromText(leaked);
  ok("the sentence is recovered from a leaked tool call", r.answer === "The slab on layer 0 measures 84.05 m².");
  ok("no markup survives into the answer", clean(r.answer));
  ok("the marks are salvaged too", Array.isArray(r.raw?.marks) && r.raw.marks[0].kind === "area");
}

/* A parameter block with no closing tag — the reply was cut off. */
{
  const cut = `<parameter name="answer">Seven doors on A-DOOR.</parameter>
<parameter name="marks">[{"kind":"dot","x":10,"y":20,`;
  const r = recoverFromText(cut);
  ok("a truncated reply still yields its sentence", r.answer === "Seven doors on A-DOOR.");
  ok("a half-written mark array does not reach the panel", clean(r.answer));
}

/* The whole reply as one JSON object. */
{
  const asJson = JSON.stringify({ answer: "There are 40 entities on A-WALL.", marks: [{ kind: "dot", x: 1, y: 2 }] });
  const r = recoverFromText(asJson);
  ok("a bare JSON reply yields its answer", r.answer === "There are 40 entities on A-WALL.");
  ok("and its marks", r.raw.marks.length === 1);
}

/* Prose with a JSON blob stuck on the end. */
{
  const mixed = 'The largest outline is on layer 0.\n[{"kind":"area","pts":[]}]';
  const r = recoverFromText(mixed);
  ok("a trailing blob is stripped, prose kept", r.answer.startsWith("The largest outline is on layer 0."));
}

/* Ordinary prose must pass through untouched. */
{
  const plain = "I can't tell how thick that wall is — the drawing records the lines, not a thickness.";
  ok("plain prose is unchanged", recoverFromText(plain).answer === plain);
}
{
  ok("empty stays empty", recoverFromText("").answer === "");
}
/* A sentence that legitimately mentions a measurement must survive. */
{
  const withNums = "Layer A-WALL carries 412.5 m of linework, which double-counts a wall drawn as two faces.";
  ok("a sentence full of figures is not mistaken for scaffolding", recoverFromText(withNums).answer === withNums);
}

let bad = 0;
for (const [what, pass] of checks) {
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${what}`);
  if (!pass) bad++;
}
console.log(`\n${bad === 0 ? `PASS — ${checks.length} checks` : `FAIL — ${bad} of ${checks.length}`}`);
process.exit(bad ? 1 : 0);
