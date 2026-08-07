# BIM Studio — prompts that work

Written against what the assistant can actually place: 68 catalogue items
across seven disciplines, plus levels and grids. A prompt naming something that
is not in the catalogue is dropped and reported, not silently ignored — but it
still wastes a turn, so these all name real items.

## Two things that decide whether a prompt works

**The specialist selector scopes what can be added.** An Electrical specialist
may only place electrical items, and may only edit electrical elements. Ask it
for a wall and it will tell you why it did not. **Coordinator (all
disciplines)** bypasses that and can place anything — use it for the first
model, and switch to a specialist when you want the scoping.

**Dependency order matters.** Doors and windows are *hosted*: they need a wall
to sit in. The assistant works in several steps and re-reads the model between
them, so "walls, then doors" in one sentence works — but only because it builds
the walls first and then reads back their ids. Asking for doors in an empty
model gets you a plain refusal.

Everything is in **metres**. Say real sizes: a room is 3–6 m across, a corridor
1.2–1.5 m, a door 0.9 m.

---

## Starting from nothing — Coordinator

The reliable opener. Small enough to draw fast, real enough to price.

```
Draw a 12 by 8 metre single-storey clinic with a central corridor, then add doors and windows
```

Others in the same shape:

```
Draw a 20 by 12 metre single-storey office with a 1.5 m corridor down the middle, four rooms either side, a door to each and windows on the long walls
```

```
Draw a 30 by 15 metre warehouse with a 6 m roller shutter on the short wall, a personnel door beside it, and a 4 by 4 metre office in the corner
```

```
Draw a two-bedroom apartment, 9 by 7 metres — living room, kitchen, two bedrooms, one bathroom — with doors and windows
```

```
Draw the ground floor of a 24 by 10 metre school block: six classrooms off a single-loaded corridor, a door per classroom and windows on the external wall
```

---

## Growing a model that already exists

These read the current model first, so they can refer to what is there.

```
Add a 3 metre wide reception at the north end
```

```
Add a second corridor running east to west across the middle
```

```
Extend the building 4 metres to the east and carry the corridor through
```

```
Add a stair core 3 by 5 metres in the south-west corner
```

```
Put a window in every external wall that does not have one
```

```
Add a 1 metre wide covered walkway along the south elevation
```

---

## Levels and multi-storey

```
Add a first floor at 3.5 metres and copy the external walls up to it
```

```
Add a roof over the whole footprint at 3 metres
```

```
Add a ground floor slab 200 mm thick under the whole building
```

---

## By discipline

**Select the specialist first.** Each of these is scoped to its own trade — the
point is that they cannot touch anyone else's work.

### Structural

```
Add columns on a 6 by 6 metre grid across the footprint
```
```
Add pad footings under every column, 1.5 by 1.5 metres
```
```
Add beams spanning between the columns in both directions
```
```
Add a 250 mm structural slab over the whole floor plate
```
```
Add shear walls either side of the stair core
```

### Electrical

```
Add lighting to the corridor and every room
```
```
Add a distribution board in the plant room and cable tray along the corridor
```
```
Add two sockets per room and one either side of the corridor
```
```
Add external light poles along the access road, 12 metres apart
```

### Mechanical

```
Add a fan coil unit in each room and ductwork along the corridor
```
```
Add supply and extract diffusers to every room
```
```
Add an air handling unit on the roof with a duct riser down to the corridor
```
```
Add an exhaust fan in each toilet
```

### Plumbing

```
Add sanitary fittings to the two toilets — WC, basin and floor drain in each
```
```
Add a water tank on the roof with a riser down to the toilets
```
```
Add a sink and drainage in the kitchen
```

### Fire

```
Add sprinklers throughout at 3 metre centres
```
```
Add smoke detectors to every room and the corridor
```
```
Add a hydrant at the main entrance and a fire pump in the plant room
```

### Civil

```
Add a 6 metre wide access road to the entrance with a parking bay for eight cars
```
```
Add a sidewalk around the building and a boundary fence with a gate
```
```
Add drainage — manholes at the corners and pipe runs between them
```
```
Add a site pad extending 3 metres beyond the building on every side
```

---

## Editing what is there

The assistant can resize, move and delete as well as add.

```
Make the external walls 300 mm thick
```
```
Make the corridor 1.5 metres wide instead of 1.2
```
```
Raise the ceilings to 3.2 metres
```
```
Move the entrance door to the middle of the south wall
```
```
Delete the furniture
```
```
Set the roof to 400 mm thick
```

Sizing works on `width`, `depth`, `height`, `thickness`, `elevation`, `sill`
and `offset` — which between them cover wall thickness, storey height, slab
depth, window sill and where a door sits along its wall.

---

## Two ways to make the demo land

**Let the client dictate one.** "Give me a building — any size, any use." A
prompt they invented, drawn in front of them, is worth more than any prepared
one.

**Follow a draw with a measure.** The prompt is not the point; the join is.

```
Draw a 12 by 8 metre single-storey clinic with a central corridor, then add doors and windows
```

then **Measure into BOQ**, and:

> "That wall knows it is a wall and it knows its length — which is why this
> works. A model becomes quantities, quantities become a bill, and every line
> can still say which element it came from."

---

## What will not work, and why

**"Make it look nicer", "add some detail", "finish it off."** There is no
command for taste. It places building elements with dimensions; vague
instructions produce vague geometry or nothing.

**Asking a specialist for another trade's work.** An Electrical specialist
asked for walls will tell you it is out of remit. That is the feature, not a
failure — say so rather than switching to Coordinator and hoping nobody noticed.

**Curved and sloped geometry.** Everything is straight lines, flat plates and
boxes. There is no arc, no ramp, no pitched roof — a roof is a flat plate at an
elevation.

**Referring to something by name it has not been given.** "Move the plant room
wall" only works if a room called that exists. Say "the wall between the
corridor and the north-east room" instead.

**Anything over about six steps.** The loop stops there. A whole hospital in
one prompt gets you the first part of a hospital. Build it in passes — shell,
then partitions, then services — which is how it would be drawn anyway.
