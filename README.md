# Zarus Diag Studio

Local web app for **cloud architecture** and **service dependency** diagrams. Drag nodes with **Kubernetes**, **AWS**, **GCP**, and common data-plane icons, connect **parent → child** handles manually, then export **PNG**, **SVG**, or **JSON**.

## Requirements

- Node.js 18+ (with npm)

## Setup

```bash
cd cloud-diagram-studio
npm install
```

## Run locally

**Development** (hot reload only — server save/load is off unless the API is running):

```bash
npm run dev
```

**Development + API** (Vite on port **5173** and Express on **3000**; Vite proxies `/api` so the **exportedfiles** panel works):

```bash
npm run dev:all
```

**Production-style** (static build + Express on port 3000):

```bash
npm run build
npm start
```

Set `PORT=8080` (or any port) to change the server port. If you change it, update the `proxy.target` in `vite.config.js` for `dev:all`.

## Persist diagrams (`exportedfiles/`)

With **`npm run dev:all`** or **`npm start`**, the right-hand **exportedfiles** section can:

- **Workspace** — choose a folder name (e.g. `team-a`, `alice`); diagrams are stored under `exportedfiles/<workspace>/`. The choice is remembered in the browser. Use **`default`** for the usual folder; the server also lists legacy flat files at `exportedfiles/*.txt` when the workspace is **`default`** (first load prefers `exportedfiles/default/<name>.txt` if both exist).
- **Save to folder** — writes `exportedfiles/<workspace>/<name>.txt` (pretty-printed **JSON** of the diagram).
- **Load from folder** — reads that file back onto the canvas (same format as **Import** / **JSON** download).

You can also open or copy those `.txt` files in an editor; they are normal JSON. **`npm run dev`** alone does not start the API, so use **`dev:all`** or **`npm start`** when you want server-side saves.

**Switching workspaces:** In the right panel, edit **Workspace** (letters, numbers, `.`, `_`, `-`; blank means `default`). The diagram list for that workspace refreshes automatically after a short pause. Click **Save to folder** — the server creates `exportedfiles/<workspace>/` on disk if it does not exist yet, then writes `<Save as>.txt` inside it. Use **Refresh** if you want to reload the list immediately.

## Usage

1. **Add nodes**: Drag items from the left library onto the canvas.
2. **Link dependencies / hierarchy**: Drag from a node’s **bottom** handle to another node’s **top** handle (arrow shows direction).
3. **Auto layout**: Click **Layout** to run a **top → bottom** hierarchical layout (Dagre). Run again after edits if nodes were resized.
4. **Edit labels**: **Double-click** a node to rename it inline (**Enter** saves, **Esc** cancels), or select a node or edge and use the right panel (edge labels work well for API names, protocols, or queue topics).
5. **Export**: **PNG 4K** renders at least **3840×2160** pixels (scaled up from the on-screen canvas with a safe pixel-ratio cap). **SVG** is vector-based. Minimap and zoom controls are omitted from images. **JSON** saves the full diagram for re-import later.
6. **Delete**: Select node(s) or edge(s) and press **Backspace** or **Delete**.

## Icons

- Most brand icons come from [Simple Icons](https://simpleicons.org/) (CC0).
- **Kubernetes workload and API resource** icons (Pod, Deployment, Service, Ingress, PVC, and the rest in the “Kubernetes resources” group) come from the [kubernetes/community](https://github.com/kubernetes/community) icon set ([Apache-2.0](https://github.com/kubernetes/community/blob/master/LICENSE)), copied into `public/icons/k8s/`.
- **Microsoft Azure** uses a small SVG under `public/icons/azure.svg` because that logo is not distributed in the Simple Icons npm package in this environment.
- **AWS architecture-style tiles** (AI/ML, analytics, integration groups) use PNGs from [awslabs/aws-icons-for-plantuml](https://github.com/awslabs/aws-icons-for-plantuml) ([Apache-2.0](https://github.com/awslabs/aws-icons-for-plantuml/blob/main/LICENSE)) under `public/icons/aws-plantuml/`.

## Project layout

| Path | Role |
|------|------|
| `server.js` | Serves `dist/` after build; **REST API** under `/api` for `exportedfiles/<workspace>/*.txt` |
| `exportedfiles/` | Saved diagrams (`.txt` files containing JSON) |
| `src/components/DiagramCanvas.jsx` | Canvas, export, import |
| `src/lib/iconRegistry.js` | Palette groups and icon keys |
| `src/lib/layoutGraph.js` | Dagre auto-layout helper |
| `public/icons/` | Extra SVG assets copied into the build |
| `public/icons/aws-plantuml/` | AWS category PNGs (AI, analytics, integration) |
