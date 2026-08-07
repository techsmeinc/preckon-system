# Preckon — the talk track

A spoken script for demonstrating **app.preckon.com**, start to finish, on a
live workspace. Roughly 25 minutes at a comfortable pace.

The runbook next to this file (`demo.html`) is the checklist — what to click,
what to have ready. This is the *words*: what to actually say, and how to say
it.

Three rules that matter more than any line below.

**Talk in the client's language, not the product's.** Never say "artifact",
"pipeline", "LLM" or "agent orchestration". Say record, stage, the software,
the assistant. If a phrase would sound odd in a site meeting, it is the wrong
phrase.

**Let silence do work.** When an agent is thinking, do not fill the gap with
apology. That pause is the proof it is reading rather than guessing — say so
once and then be quiet.

**Never claim what you have not shown.** This product's whole argument is that
every number can name its source. The moment you overstate one thing, the
client is entitled to doubt all of it.

---

## 0 · Opening — 45 seconds

> "Before I show you anything, one sentence about what this is.
>
> Preckon reads a tender the way an estimator does — the documents, the
> drawings, the specification — and builds the bill, the prices and the
> programme from them. The difference from anything else you have seen is
> not speed. It is that every number on screen can tell you where it came
> from: which page of which document, or which layer of which drawing.
>
> I am going to build a bid from nothing in about twenty minutes. Stop me
> whenever you want to test something."

**How:** Stand still. Do not touch the mouse while you say this. The invitation
at the end is not politeness — a demo where the client interrupts is a demo they
believe.

---

## 1 · Create the project — 1 minute

**Do:** New project → name it something plainly generic, `Clinic Extension —
Phase 2`. Client, code, Create.

> "That is the whole setup. A name, a client, a code.
>
> What it just did is put this bid onto a lifecycle — the stages you can see
> along the top. Documents, Tender, Drawings, Specs, Bill of quantities,
> Estimate, Schedule, Technical narrative, Procurement, and finally
> Submission. That is a bid, in the order you actually do it."

**How:** Type the name at normal speed; do not narrate the typing. Point at the
stage tabs with the cursor as you list them, slowly enough to read.

---

## 2 · Upload the tender — 1 minute

**Do:** Documents → drag in a tender PDF and a drawing set.

> "Now the documents. A tender, a specification, and the drawings.
>
> Watch the status column. It is not filing these — it is reading them. The
> PDF is being broken into pages and the drawings are being parsed properly:
> layers, blocks, units. In a moment the software will quote this tender back
> at us with a page number."

**If somebody asks about DWG:** "Yes, DWG as well as DXF — it converts on the
server, you do not need AutoCAD installed anywhere."

---

## 3 · Read the tender — 2 minutes

**Do:** Tender tab → Run.

> "This takes real time, and I want you to see that it does. It is reading
> the document rather than pattern-matching it. That is the trade — slower
> than a search, but it comes back with clauses rather than keywords."

**Do:** When it pauses at the gate — stop and point at it.

> "Now look at this. It has stopped.
>
> That is a gate. The software will not carry on past a decision that is
> mine to make. It has read the scope and it is proposing a summary — and
> until I accept it, nothing downstream of it runs.
>
> This is the rule the whole product is built on: the software proposes,
> a human disposes. Nothing an agent produces becomes a fact in this bid
> until somebody here says so."

**Do:** Open the proposal. Show the source. Accept it.

> "Before I accept — see this panel. That is where it came from. Not 'the
> AI thinks', but page four of the instructions to bidders."

**How:** This is the most important minute of the demo. Slow down. Let them
read the source panel themselves before you click Accept.

---

## 4 · The drawings — 6 minutes

This is where a room of estimators stops being polite. Give it the time.

**Do:** Drawings tab → Issued drawings → pick a sheet.

> "This is the drawing they sent us. Not a picture of it — the actual
> geometry, parsed.
>
> Beside it: the units, the footprint, the block counts, and the length of
> linework on every layer. These are the exact facts the software was given.
> When somebody questions a quantity in six weeks' time, this is where the
> answer is."

**Do:** Zoom into a detail with the wheel so they see it is the real drawing.

### 4a · Ask the drawing a question

**Do:** Edit & mark up → the assistant panel, top right.

> "Now — this is the part I would not have believed either.
>
> I can ask the drawing a question."

**Do:** Type `What is the largest floor area, and on which layer?` — read it
aloud as you type.

> "Watch what comes back. Not just a number — it marks the outline it
> measured, right there on the drawing, and it tells me which layer it read
> it off.
>
> And notice what it volunteers. It says the sum of the closed outlines on
> that layer is not a floor area, because they overlap. It is telling me how
> its own number could be wrong. That is not politeness — that is the
> difference between a figure you can put in a bill and one you cannot."

**How:** Let them choose the second question. `How many doors?` or `Summarise
this drawing` both land.

### 4b · Mark it up

**Do:** Set units to mm. Press F3, then F8. Start a line and hover a wall end,
a midpoint, a crossing.

> "For anyone here who has drafted — endpoint, midpoint, intersection. F3,
> F8, F10. They do what they have always done."

**Do:** Dimension something. Hatch a room.

> "The dimension value is measured off the geometry, not typed. And both of
> these go on their own layers, so whoever receives it can switch our markup
> off."

**How:** The snap markers earn more credibility with a technical audience than
anything else in the demo. Do not rush them.

### 4c · Build one from nothing

**Do:** BIM Studio → Full screen → type the prompt, read it aloud.

`Draw a 12 by 8 metre single-storey clinic with a central corridor, then add doors and windows`

> "It has not drawn a picture of a building. It has placed building
> elements. That wall knows it is a wall and it knows its length — which is
> why the next thing works."

**Do:** Switch to Split. Let the 3D turn.

> "Same model, stood up. Real widths, real heights, real levels — because
> this one is a model, not a drawing. It is here to answer 'does that read
> as a building', not to take quantities off."

**Do:** Measure into BOQ. Scroll to the register.

> "And that is the join. A model becomes quantities, quantities become a
> bill, and every line can still say which element it came from.
>
> Fifteen minutes ago this building did not exist."

---

## 5 · Specs — 1 minute

**Do:** Specs tab.

> "The specification, broken into clauses, each one traceable back to its
> page. This is what stops a bill being priced against the wrong standard —
> when the estimator prices blockwork, the clause that governs it is one
> click away."

**How:** Keep this short. It is a supporting act.

---

## 6 · The bill — 3 minutes

**Do:** BOQ tab.

> "Here is the bill. Grouped by division, units normalised.
>
> Now — pick a line. Any line. You choose."

**Do:** Genuinely let them choose. Click through to its trace.

> "That quantity came from that measurement, which came from that layer of
> that drawing. Or that page of that document.
>
> This is the question every estimator gets asked in a post-tender meeting,
> and it is normally answered from memory."

**How:** This is the emotional peak. Do not talk over it. Let them look.

**If a quantity is visibly wrong** — and one might be — do not deflect:

> "Good. That is exactly the case this is built for. Watch."

**Do:** Correct it. Show the stale cascade.

> "I have just disagreed with the software. It kept its version, recorded
> mine against my name, and told me exactly what now needs re-running.
> That is the part estimating software has always been missing — not the
> correction, the consequences of it."

---

## 7 · The estimate — 2 minutes

**Do:** Estimate tab. Point at a rate source.

> "Rate times quantity equals amount, on every line. And each rate says
> where it came from — your own rate book, history, or a person who typed
> it. There is no third category where a number just appears."

**Do:** Correct a rate if it looks wrong.

> "Rates are yours. The software will use your rate book if you give it
> one, and tell you when it could not find a rate rather than inventing
> one."

---

## 8 · The programme — 2 minutes

**Do:** Schedule tab. Point at an activity's driving quantity.

> "That duration exists because of that quantity and that output rate. It
> is not drawn by feel.
>
> Which means if the quantity changes, this goes stale and says so. A
> programme that silently disagrees with the bill is how projects lose
> money before they start."

---

## 9 · Narrative and procurement — 90 seconds

**Do:** Technical Narrative → Generate on one section only.

> "The part of a submission that always gets written at midnight. Section
> by section, drawn from this bid's own records — so the method statement
> describes the work that is actually in the bill.
>
> Generated one at a time on purpose. You accept one and rewrite another."

**Do:** Procurement tab.

> "And the scope grouped into packages by trade, ready to go out for
> quotes."

---

## 10 · Submission — 2 minutes

**Do:** Submission tab.

> "Last one, and this is the least clever screen in the product — which is
> why I like it.
>
> Everything up to here was derived. Quantities from drawings, rates from
> the bill, programme from the quantities. None of this is. A bid bond is
> chased from a bank. An insurance certificate from a broker. A signed form
> of tender from a director who is in a meeting.
>
> So it is a register, not another clever stage. What is outstanding, who is
> chasing it, and are we complete. That is the only question anybody asks in
> the last two days of a bid."

**Do:** Point at the readiness figure and one outstanding item.

> "And the standard list is a starting point — every client's instructions
> to bidders are different, so you add what this one asks for."

---

## 11 · The exports — 2 minutes

**Do:** BOQ → Export Excel → open it.

> "This is the format you submit in. Not an export you then spend a day
> reformatting — a cover sheet with your letterhead, one sheet per division,
> and a summary that foots.
>
> Look at the unpriced items. They say 'to be priced' rather than showing
> zero, and the total says it is provisional. A bill that quietly totals
> zeroes is how a bid gets submitted short."

**Do:** Schedule → Export Excel → open it.

> "And the programme, as a proper Gantt."

**How:** Have Excel already open once before the demo so the first open is
instant. Thirty seconds of cold start here is thirty seconds at the worst
possible moment.

---

## 12 · Close — 1 minute

**Do:** Trace → Verify audit chain. Then switch the language to Arabic and
leave it for a beat.

> "Everything you have watched me do is on that chain. If a record were
> altered behind the application's back, that check is where it would show.
> That is the difference between a log and evidence.
>
> And if half your team works in Arabic — same workspace. Not a translated
> copy of it."

**Do:** Switch back to English. Stop clicking. Then:

> "So — twenty minutes, from an empty project to a priced bill, a
> programme, a technical submission and a register of what is still
> outstanding.
>
> But the number of minutes is not the argument. This is:
>
> Every number you have seen today can name where it came from. A page of a
> tender, a layer of a drawing, or a person who typed it and signed for it.
>
> That is the whole product. The rest is speed."

**How:** Say the last three lines slowly, and then stop talking. Do not add
anything. Let them ask the first question.

---

## What not to promise

If asked, these are true and you should say so plainly:

- **Two people cannot edit the same drawing at once.** Markup is per-person
  until saved, and two people produce two revisions rather than one merged
  drawing.
- **The 3D view of a DXF assumes a storey height.** A DXF carries no heights.
  It is a sense-check, not a model.
- **It does not replace an estimator.** It does the reading and the arithmetic
  and shows its working. Somebody still has to decide.

> "Not today. Tell me what that would let you do and I will find out where
> it sits."

That sentence costs nothing. Guessing costs the deal, about a week after
they sign.
