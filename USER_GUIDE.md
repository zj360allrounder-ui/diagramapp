# Zarus Diag Studio — User guide (for everyone)

This guide is for **people who draw architecture or dependency diagrams** and do not need to know how the software is built. Share it as a handout or slide outline for training.

---

## 1. What is this tool?

**Zarus Diag Studio** is a **diagram editor in the web browser**. You use it to draw:

- **Systems and services** (apps, databases, queues, APIs, cloud products, Kubernetes parts, and more).
- **How they connect** (lines with optional labels, e.g. “HTTPS” or “Kafka topic”).
- **Optional grouping** (swimlanes / frames, like “Production” vs “Staging”).

You get a **picture** you can put in documents, wikis, or slides, and a **data file** you can keep for later editing.

**You do not need to install anything** if your organisation already hosts the app for you—you only open a link. If you run it on your own computer, someone technical will use the **README** for install steps.

---

## 2. Parts of the screen (quick tour)

| Area | What it is for |
|------|----------------|
| **Top bar** | App name, **workspace** and **save/load** controls (see §6), **Light / Dark** theme. |
| **Left: Library** | Icons to drag onto the canvas; **search**; **templates** and **+ Swimlane**. |
| **Middle: Canvas** | Your diagram. Scroll to pan, use the **mouse wheel** or corner controls to zoom. Small **minimap** helps you move around big diagrams. |
| **Right: Selection** | Opens when you pick something: edit labels, notes, “parent” hierarchy, find nodes, local draft options, and **Tips**. You can hide this panel with the **‹ / ›** tab on its edge to get more canvas space. |
| **Floating bar (on canvas)** | **Layout**, **PNG 4K**, **SVG**, **JSON**, **Import**, **Clear**, grid snap, align tools, **Find**. |

---

## 3. First diagram in five minutes

1. **Add a service**  
   In the **Library**, open a section (e.g. “Cloud & data”). **Drag** a tile (e.g. “PostgreSQL”) onto the **canvas** and release.

2. **Add another service**  
   Drag a second tile (e.g. “API” or “Web app”).

3. **Connect them**  
   Each box has **small dots (handles)** on the sides. **Click and drag** from one handle to a handle on another box. A line appears.

4. **Rename a box**  
   **Double‑click the text** under the icon, type a name, press **Enter** to finish (or **Esc** to cancel).

5. **Tidy the layout**  
   Press **Layout** on the floating toolbar. The tool rearranges boxes **top to bottom** automatically. Press again after big changes if things look crowded.

6. **Save a picture**  
   Press **PNG 4K** for a large, sharp image, or **SVG** for a file that scales well in design tools. Your browser will **download** a file.

That is enough for a simple training session. The sections below add the next level of detail.

---

## 4. Library: icons, templates, swimlanes

### Icons

- **Open / close groups** by clicking the **section title** (chevron).
- **Search**: type a name (e.g. `s3`, `redis`, `github`) to filter icons.
- **Drag** a tile to the canvas. **Drop** it on another service to set a **quick parent** link (hierarchy)—optional; see §5.

### Templates

Under **Templates & frames**, buttons like starter layouts add **several nodes and lines at once**. Good for demos or a consistent starting point.

### Swimlane (+ Swimlane)

A **swimlane** is a **titled frame** on the canvas. Drag services **inside** the frame to show they belong to that area (e.g. “VPC”, “Team A”). You can **drag the title bar** to move the whole frame.

---

## 5. Lines, labels, and “parent” hierarchy

### Ordinary connections

- Drag from any **handle** to any **handle** (not only bottom–top).
- **Click a line** to select it, then use the **right panel** to add an **edge label** (e.g. protocol, topic name, “sync call”).

### Parent (tree) relationships

Some teams use a **parent → child** idea (e.g. “Account contains these services”):

- **Double‑click the icon** (not the title) on a service node to open the **parent** control, **or** use the **right panel** when that node is selected.
- You can also **drop** a new icon **onto** an existing node to link it as a child.

---

## 6. Workspace and saving (three different ideas)

**Sign in first.** The studio opens on a **login** screen. Use the username and password your admin gave you (or the local defaults from the README while testing). Use **Sign out** in the header when you are done.

People mix these up—here is the distinction in plain language.

### A) Automatic draft in the browser (no IT required)

- If **Autosave draft locally** is on (right panel → **Local draft**), the app **saves your work in this browser** every minute or so after you change the diagram.
- It also saves the **workspace** name you picked in the header, **with** that draft—so after a refresh you get **the same folder context** back.
- If you see a **yellow banner** after reload, that is the draft being restored. **OK** dismisses the message; **Clear & remove draft** deletes the recovery copy.

**Limit:** clearing site data, another browser, or another computer will **not** have that draft.

### B) Save on the company server (needs the app running with server)

In the **top bar** you have:

| Control | Plain meaning |
|---------|----------------|
| **Workspace** | Which **folder** on the server your diagrams belong to (e.g. your team name). Pick from the list; use **+ New workspace…** to type a new folder name. |
| **Save as** | File name (without typing `.txt`). |
| **Save** | Writes the diagram to the server under that workspace. |
| **Load** | Pick a saved diagram name from the list, then **Load**. |
| **↻** | Refreshes **workspace list** and **diagram list** from the server. |

**If Save / Load do nothing or show “server unavailable”**, the person who runs the app must start it **with the API** (they will know `npm run dev:all` or `npm start` from the README).

### C) Download a file you can email or put in SharePoint

- **JSON** — full diagram data; you can **Import** it later on any copy of the app.
- **PNG 4K** / **SVG** — images for documents.

---

## 7. Editing habits that prevent lost work

1. **Use the server Save** when your organisation supports it—then the file lives on disk, not only in your browser.  
2. **Or** download **JSON** at the end of the day and keep it somewhere safe.  
3. Before **Load** or **Import** from someone else, read the confirmation—**unsaved changes** can be replaced.  
4. **Workspace** switching clears the **Load** pick list selection on purpose—pick the diagram again after changing folder.

---

## 8. Handy shortcuts and tools

| You want to… | How |
|----------------|-----|
| Delete something | Select it, press **Delete** or **Backspace**. |
| Select several items | **Shift**‑click each one. |
| Copy a selection | **Ctrl + D** (Windows) or **⌘ + D** (Mac). |
| Nudge a selection | **Arrow keys**; hold **Shift** for bigger steps. |
| Line up several boxes | Select **2+** in the **same swimlane or canvas**, use **Align** / **Distribute** on the floating bar. |
| Find a node by name | **Find** on the floating bar; click a result to zoom to it. |
| Snap to a neat grid | Turn on **Snap 20** on the floating bar. |

---

## 9. Text notes and sticky‑style tags

- From the library you can add **text note** nodes (often with **tags** like risk / question / WIP).
- **Double‑click** the note body to edit; **Esc** cancels.

---

## 10. Light and dark mode

Use **Light** / **Dark** in the **top right** if the screen is hard to read in your room or on a projector.

---

## 11. Glossary (simple definitions)

| Term | Meaning |
|------|---------|
| **Canvas** | The big drawing area. |
| **Workspace** | Server folder name so teams do not overwrite each other’s files. |
| **JSON (here)** | A text file that stores the whole diagram so you can reopen it later. |
| **PNG / SVG** | Image files for slides and documents. |
| **Swimlane** | A labelled frame around a group of services. |
| **Layout** | Automatic tidy arrangement (top → bottom). |

---

## 12. If something goes wrong

| Symptom | What to try |
|---------|----------------|
| Save / Load not working | Ask IT to confirm the app is running **with** the server (`README`). Try **↻**. |
| Blank or old diagram after refresh | Check the **yellow restore banner**; your browser draft may have come back. |
| Cannot find an icon | Use **Search icons** in the library. |
| Lines look messy | Press **Layout** again; resize swimlanes if you use them. |

When in doubt, **export JSON** before risky actions—that is your portable backup.

---

## 13. For trainers

- **15‑minute session:** §1–3 + **PNG** export.  
- **30‑minute session:** add §5–6 and **workspace** on the server.  
- **Handout:** print §2 (screen tour) + §8 (shortcuts) + §11 (glossary).

Technical setup, ports, Docker, and file paths for administrators stay in **README.md** in this same folder.
