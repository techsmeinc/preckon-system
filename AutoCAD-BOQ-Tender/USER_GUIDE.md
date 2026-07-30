# DrawLogix & TenderLogix — Simple Guide

*A plain-English guide to what this software does and how to use it.*

---

## What is this?

This is a set of tools for a construction company. In simple terms, it helps you do three big jobs:

1. **Price a tender** — you give it the tender documents and drawings, and it works out the Bill of Quantities (BOQ) and a priced quotation for you.
2. **Make drawings** — you describe a building or a site in plain words (or attach a photo, an Excel sheet, or a voice note), and it draws it for you. You can then tidy it up with normal drawing tools.
3. **Build a 3D model** — you talk to an AI team (an architect, a structural engineer, an electrician, and so on) and they build a 3D building model for you, one discipline at a time.

Everything runs in your web browser. Nothing needs AutoCAD or Revit installed to *make* the work — but you can **export** your work as AutoCAD (DWG) or Revit (IFC) files when you're done.

---

## The three parts, explained simply

### 1. The BOQ / Tender platform ("TenderLogix")
This is the main website. You upload the tender package (the RFP, scope of work, specifications, and any AutoCAD drawings). The software **reads and understands** them — even scanned pages and photos — and produces a **priced Bill of Quantities**. It counts things from the drawings (doors, windows, fixtures) and measures lengths (walls, pipes, cables) automatically, then prices them and gives you a **ready-made Excel quotation**.

It also has extras: a **work programme** (a proper project schedule with a critical path and resources), a **technical narrative** writer for your bid, and a built-in **drawing viewer** where you can mark up and even edit the CAD files.

### 2. DrawLogix — the drawing studio
This is where you **make drawings from scratch**. You don't need to draw anything yourself. You write a short brief like *"a warehouse yard with a fence, a gate, an office and parking,"* attach anything useful (a sketch photo, an Excel room list, or dictate a voice note), and it produces a **proper dimensioned drawing** — with walls, dimensions, a title block, and a legend. Then you can:
- **Ask it to change things** in plain words (add a room, remove the store, add dimensions).
- **Open it in the CAD editor** and edit it by hand like AutoCAD (draw lines, add doors, move things, add dimensions).
- **Download it** as a DWG (for AutoCAD), a DXF, or an IFC (for Revit).

### 3. The BIM Studio — a 3D model built by an AI team
This is the newest and biggest part. It's like having a design team you talk to. You open the **BIM Studio**, and on the right there's an **AI Assistant**. You pick which **specialist** you're talking to from a dropdown, then just tell them what you want:
- The **Architect** does walls, doors, windows, rooms, roofs, stairs.
- The **Structural Engineer** does columns, beams, foundations, slabs.
- The **Civil Engineer** does the site — roads, parking, fences, drainage.
- The **Electrical Engineer** does lights, sockets, switches, panels.
- The **HVAC Engineer** does air-conditioning — ducts, diffusers, units.
- The **Plumbing Engineer** does toilets, basins, pipes, tanks.
- The **Fire Engineer** does sprinklers, detectors, alarms, hydrants.
- A **Coordinator** can do everything at once if you want.

Each specialist only touches their own work. If you ask the electrician to add columns, they'll politely say that's the structural engineer's job and leave it — just like a real firm. You can see the model in **3D**, as a **2D plan**, or **both side by side**, and there's a **legend** showing what every colour and symbol means.

---

## How to start the software

The easiest way:

1. Go to the project folder: `C:\Users\IKIO\Downloads\New\AutoCAD-BOQ-Tender`
2. **Double-click `start-servers.bat`**. Two black windows will open — leave them running.
3. Wait about 10 seconds, then open your browser to:
   **http://localhost:5173/drawlogix/studio**

To stop the software, just close those two black windows.

> If you ever see a **"failed to fetch"** or **"application error"**, it almost always means one of those windows was closed. Just double-click `start-servers.bat` again and refresh the page.

---

## How to use it — step by step

### To make a drawing (DrawLogix Projects)
1. Open **http://localhost:5173/drawlogix/projects**.
2. Click **New project**, give it a name.
3. In the **brief** box on the left: type what you want, or **drop in files** (photos, Excel, PDF), or click **🎙 Dictate** to speak it. There are also **example buttons** to get you started.
4. Click **Generate drawing**. Wait about half a minute.
5. The drawing appears on the right. **Scroll to zoom, drag to move.**
6. To change it, use the **assistant** at the bottom-left — e.g. *"add a store next to reception,"* *"remove the generator,"* *"add dimensions."*
7. To download it, use the buttons on the drawing: **DWG**, **DXF**, or **IFC (Revit)**.
8. To hand-edit it, click **Edit in CAD** — it opens in the drawing editor.

### To edit a drawing by hand (CAD editor)
1. Open **http://localhost:5173/drawlogix** (or click "Edit in CAD" from a drawing).
2. Use the toolbar to **draw** (line, rectangle, circle, text, dimension) and **change** (move, copy, rotate, scale, mirror).
3. Turn on **snapping** (F3), **straight lines** (F8) for precision.
4. You can also just **tell the AI copilot** what to change instead of drawing.
5. Export the finished DXF, or see the live **priced BOQ** panel.

### To build a 3D model (BIM Studio)
1. Open **http://localhost:5173/drawlogix/studio**.
2. On the right, in the **AI panel**, start with the **Coordinator** and type something like:
   *"Design a single-storey office, 16×10 m: reception, 3 offices, a meeting room, a pantry and 2 WCs, with doors and windows."*
3. When the building appears, **switch the specialist dropdown** and add each discipline:
   - **Structural** → *"Add columns on a 5 m grid with beams and footings."*
   - **Electrical** → *"Add lights, sockets and a distribution board."*
   - **Mechanical** → *"Add air-conditioning to each room."*
   - **Plumbing** → *"Add toilets, basins and a water tank."*
   - **Fire** → *"Add sprinklers and smoke detectors."*
   - **Civil** → *"Add a fence, gate, road and parking."*
4. Use the **3D / 2D / Split** buttons at the top to change the view.
5. **Click any part** in the model to select it, then change its size in the right panel.
6. Use **Undo / Redo** at the top if you don't like a change.
7. Turn disciplines on/off with the checkboxes on the left to review each package.

---

## The AI assistants (in simple terms)

Think of the AI like staff you can talk to:

- In **Projects**, the assistant is a **draughtsman** — it draws and edits your 2D drawing.
- In the **CAD editor**, the assistant is a **CAD operator** — it makes the edits you describe.
- In the **BIM Studio**, you have a **whole design team** — pick the specialist you need and give them instructions. They know their trade (sensible room sizes, standard column grids, correct light spacing, sprinkler spacing, and so on) and they stay in their lane.

You can talk to any of them by **typing** or by **speaking** (the microphone button).

---

## Saving and sharing your work

- **DWG** — opens in AutoCAD (this is the real AutoCAD file, not just DXF).
- **DXF** — opens in most CAD programs, with proper editable dimensions.
- **IFC** — opens in **Revit** (File → Open → IFC) and other BIM tools as a real 3D model.
- Your BOQ comes out as a **styled Excel quotation**.

---

## Handy tips

- Start big, then refine. One prompt to make the shell, then small prompts to adjust.
- Speak instead of typing — press the **🎙** button.
- If a change goes wrong, just say **"undo"** or press the Undo button.
- Click things to select and fine-tune their size.
- On a phone or a small window, the side panels turn into **slide-in drawers** — use the **Tools** and **AI Assistant** buttons to open them.
- Read the **Legend** (top-right in the BIM Studio) to know what each colour means.

---

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| "Failed to fetch" | A server window was closed | Double-click `start-servers.bat`, refresh |
| "Application error" | A page hiccup | Refresh the page (Ctrl+F5); use **Reload** if offered |
| Drawing didn't change | The AI had nothing to change, or wrong page | Check your wording; try again |
| "DWG needs the converter" | The AutoCAD converter isn't found | Make sure the ODA File Converter is installed |
| Audio upload asks for a key | No transcription key set | Use the **🎙 Dictate** button instead (no key needed) |

---

## In one sentence

**You describe what you want — a price, a drawing, or a building — and the software (with an AI team behind it) produces it, ready to export to AutoCAD or Revit.**

*This guide covers everything built so far. For the technical details (files, architecture, agents), see `PROJECT_DOCUMENTATION.md`.*
