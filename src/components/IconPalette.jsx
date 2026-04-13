import { useCallback, useMemo, useState } from 'react';
import { PALETTE_GROUPS, getFilteredPaletteGroups, resolveIcon } from '../lib/iconRegistry.js';
import { DIAGRAM_TEMPLATES } from '../lib/diagramTemplates.js';
import { useDiagramActions } from '../context/DiagramActionsContext.jsx';

const DND_TYPE = 'application/cloud-diagram-node';

export function onDragPaletteStart(ev, item) {
  ev.dataTransfer.setData(DND_TYPE, JSON.stringify(item));
  ev.dataTransfer.effectAllowed = 'copy';
}

function groupSlug(title) {
  return title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'group';
}

function PaletteTile({ item }) {
  const spec = resolveIcon(item.iconKey);
  const fill = `#${spec.hex}`;

  return (
    <button
      type="button"
      className="palette-tile"
      draggable
      onDragStart={(e) =>
        onDragPaletteStart(e, {
          iconKey: item.iconKey,
          label: item.defaultLabel,
          ...(item.nodeType ? { nodeType: item.nodeType } : {}),
          ...(item.noteTag ? { noteTag: item.noteTag } : {}),
        })
      }
      title={`Drag to canvas: ${item.defaultLabel}`}
    >
      <span className="palette-tile__icon" style={{ background: fill }}>
        {spec.kind === 'url' ? (
          <img src={spec.url} alt="" draggable={false} />
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden>
            <path fill="#fff" d={spec.path} />
          </svg>
        )}
      </span>
      <span className="palette-tile__text">{item.defaultLabel}</span>
    </button>
  );
}

export default function IconPalette() {
  const actions = useDiagramActions();
  const [search, setSearch] = useState('');
  const [openByTitle, setOpenByTitle] = useState(() => {
    const init = {};
    PALETTE_GROUPS.forEach((g, i) => {
      init[g.title] = i === 0;
    });
    return init;
  });

  const filteredGroups = useMemo(() => getFilteredPaletteGroups(search), [search]);
  const matchCount = useMemo(() => {
    if (!filteredGroups) return 0;
    return filteredGroups.reduce((n, g) => n + g.items.length, 0);
  }, [filteredGroups]);

  const toggleGroup = useCallback((title) => {
    setOpenByTitle((prev) => ({ ...prev, [title]: !prev[title] }));
  }, []);

  const groupsToRender = filteredGroups ?? PALETTE_GROUPS;
  const searching = filteredGroups != null;

  return (
    <aside className="icon-palette">
      <div className="icon-palette__intro">
        <strong>Library</strong>
        <p>
          Click a <strong>section title</strong> to show or hide its icons. Drag tiles onto the canvas;
          connect nodes from any side handle.
        </p>
      </div>
      <div className="icon-palette__search-wrap">
        <label className="icon-palette__search-label" htmlFor="icon-palette-search">
          Search icons
        </label>
        <input
          id="icon-palette-search"
          type="search"
          className="icon-palette__search"
          placeholder="e.g. github, terraform, grafana…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {searching && (
          <p className="icon-palette__search-hint" role="status">
            {matchCount === 0
              ? 'No matches — try another word.'
              : `${matchCount} match${matchCount === 1 ? '' : 'es'} in ${filteredGroups.length} section${filteredGroups.length === 1 ? '' : 's'}`}
          </p>
        )}
      </div>
      {!searching ? (
        <div className="icon-palette__starters">
          <div className="icon-palette__starters-title">Templates & frames</div>
          <div className="icon-palette__starter-btns">
            {DIAGRAM_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="icon-palette__starter-btn"
                onClick={() => actions?.applyTemplate?.(t.id)}
              >
                {t.label}
              </button>
            ))}
            <button
              type="button"
              className="icon-palette__starter-btn icon-palette__starter-btn--lane"
              onClick={() => actions?.insertSwimlane?.()}
            >
              + Swimlane
            </button>
          </div>
          <p className="icon-palette__starters-hint">
            Templates add starter nodes and edges. Swimlane is a titled frame — drop icons inside it.
          </p>
        </div>
      ) : null}
      {groupsToRender.map((group) => {
        const open = searching || !!openByTitle[group.title];
        const slug = groupSlug(group.title);
        const panelId = `palette-panel-${slug}`;
        const headId = `palette-head-${slug}`;
        return (
          <section key={group.title} className="icon-palette__group">
            <button
              type="button"
              id={headId}
              className={`icon-palette__group-heading${searching ? ' icon-palette__group-heading--locked' : ''}`}
              onClick={() => {
                if (!searching) toggleGroup(group.title);
              }}
              aria-expanded={open}
              aria-controls={panelId}
            >
              <span className={`icon-palette__group-chevron ${open ? 'icon-palette__group-chevron--open' : ''}`} aria-hidden>
                ›
              </span>
              <span className="icon-palette__group-title">{group.title}</span>
            </button>
            {open ? (
              <div className="icon-palette__grid" id={panelId} role="region" aria-labelledby={headId}>
                {group.items.map((item) => (
                  <PaletteTile
                    key={`${group.title}-${item.iconKey}-${item.defaultLabel}-${item.noteTag ?? ''}`}
                    item={item}
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </aside>
  );
}

export { DND_TYPE };
