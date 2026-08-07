# Every prompt, one sheet

Four places in Preckon take a written instruction, and they are not
interchangeable. Each one can see a different thing, which is the only rule you
need to hold in your head:

| Where | What it can see | What it does |
|---|---|---|
| **Copilot** — sidebar | the workspace, then one project's **confirmed** records | answers with sources |
| **Ask Copilot** — inside a project | that project only | answers with sources |
| **Ask about this drawing** — drawing editor | the sheet open on screen | measures, counts, marks, edits |
| **BIM Studio** — Drawings stage | the model you are building | places building elements |
| **Colleagues** — inside a project | its own slice of the project | answers as a specialist |

Ask the drawing editor for a rate and it has no idea. Ask Copilot to draw a wall
and it will not. That is not a limitation to apologise for — it is why each
answer can be trusted.

Print this. Keep it beside the laptop.

---

## 1 · Copilot — the whole bid

Sidebar → Copilot, or **Ask Copilot** on a project. It answers from records that
have been **confirmed**, and cites them.

**The opener.** Always true, always different, and it demonstrates the review
queue without you explaining it.

```
What is waiting on my decision in this bid?
```

**The one that makes the point.**

```
Where did the concrete quantities come from?
```

**Others worth having ready:**

```
Which proposals have low confidence, and why?
```
```
Summarise the submission requirements and the deadline
```
```
How much of the bill is still unpriced?
```
```
What does the specification say about blockwork?
```
```
Which BOQ lines have no rate against them?
```
```
What changed on this bid in the last day?
```
```
Which activities are on the critical path, and what drives them?
```
```
Is anything in this bid marked stale?
```

**Say this while it answers:**

> "It answers from this bid's confirmed records and cites them. Ask it about
> another project's numbers and it cannot see them — that is not a policy
> setting, it is the query."

**What it cannot do:** price something that has no rate, invent a quantity, read
a document nobody uploaded, or answer about a record still sitting unconfirmed.
If a stage has not been accepted yet, say so rather than letting it look empty.

---

## 2 · Ask about this drawing — the drawing editor

Drawings → **Edit & mark up** → the panel top-right. It reads the sheet as it
stands on screen, including markup added a minute ago and not yet saved.

**Start here.** It marks what it measured, on the drawing, in amber.

```
What is the largest closed outline, and on which layer?
```

**Measuring and counting:**

```
Summarise this drawing
```
```
How much linework is on each wall layer?
```
```
How many times does "BED ROOM" appear on this sheet?
```
```
What are the overall dimensions of the building?
```
```
Which layer carries the most geometry, and what is on it?
```
```
What units is this drawing in, and does it say so?
```

**Editing.** Say what, where, and on which layer:

```
Add a wall on A-WALL along the top edge of the largest outline
```
```
Draw a rectangle on A-FLOOR, 4000 by 3000, inside the largest outline
```
```
Put a note on NOTES at the bottom left saying REVISED 07/08
```
```
Trace a closed outline round the two bedrooms on a layer called TAKEOFF
```
```
Delete the layer BA-C-DIM50
```

**Three things that change what you type:**

- **Coordinates are the drawing's own.** A sheet may sit at x = −2,234,953. "Add
  a wall at the origin" lands two kilometres away, invisible. Say it relative to
  something it can see — *"from the corner of the largest outline"*.
- **Units are drawing units.** On a millimetre sheet, `5000` is 5 m.
- **Everything is undoable.** The panel says what it added or removed, `Ctrl+Z`
  reverses it, and nothing reaches the project until **Save to project** — which
  saves a new revision, never overwriting the issued drawing.

**Say this when the answer comes back:**

> "Notice what it volunteers. It tells me the sum of the outlines on that layer
> is not a floor area, because they overlap. It is telling me how its own number
> could be wrong."

**What it cannot do:** tell you a line is a wall. A drawing records a line on a
layer somebody named A-WALL. It will cite the layer and let you decide — and
that honesty is the demo, so do not apologise for it.

---

## 3 · BIM Studio — building from nothing

Drawings → BIM Studio. Select the **specialist** first: each is scoped to its
own trade, and **Coordinator** can place anything.

**The reliable opener:**

```
Draw a 12 by 8 metre single-storey clinic with a central corridor, then add doors and windows
```

**Then, to show the scoping** — switch to Electrical:

```
Add lighting to the corridor and both consulting rooms
```

**And one more trade** — Plumbing:

```
Add sanitary fittings to the two toilets — WC, basin and floor drain in each
```

**Editing:**

```
Make the external walls 300 mm thick
Add a 3 metre wide reception at the north end
Add a first floor at 3.5 metres and copy the external walls up to it
```

The full library — 68 catalogue items across seven disciplines, plus what will
not work — is in `bim-prompts.md` beside this file.

**Then press Measure into BOQ and say:**

> "That is the join. A model becomes quantities, quantities become a bill, and
> every line can still say which element it came from."

---

## 4 · Colleagues — the specialists

Project → Colleagues. Each one sees its own slice of the bid, so ask it about
its own work rather than the whole project.

```
Does anything in this look wrong to you?
```
```
What would you challenge in these quantities?
```
```
What is the biggest risk in this programme?
```
```
What have we missed that a client usually asks for?
```

**Say this:**

> "Each of these sees only their part of the bid. Ask the planner about rates
> and they will tell you it is not theirs. That is deliberate — an opinion from
> someone who can only see half the picture is worth more when you know which
> half."

---

## The order to show them in

1. **Copilot** — `What is waiting on my decision in this bid?`
   Sets up the review queue without explaining it.
2. **Drawing editor** — `What is the largest closed outline, and on which layer?`
   The mark on the canvas is the moment the room goes quiet.
3. **BIM Studio** — the clinic prompt, then Measure into BOQ.
   Nothing existed fifteen minutes ago; now it is priced.
4. **Copilot again** — `Where did the concrete quantities come from?`
   Closes the loop you just opened.

---

## Let them write one

The strongest prompt in any demo is the one the client invents. Invite it
explicitly:

> "Give me a building. Any size, any use."
>
> "Pick a line in that bill and I will show you where the number came from."
>
> "Ask it something you think it should get wrong."

If it does get something wrong, that is the good case, not the bad one:

> "Good — watch what happens now."

Then correct it and show the stale cascade. A demo where the software is
caught out and recovers cleanly is worth three where nothing goes wrong.
