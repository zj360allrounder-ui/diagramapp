import { useCallback, useState } from 'react';
import { PALETTE_GROUPS, resolveIcon } from '../lib/iconRegistry.js';

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
        onDragPaletteStart(e, { iconKey: item.iconKey, label: item.defaultLabel })
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
  const [openByTitle, setOpenByTitle] = useState(() => {
    const init = {};
    PALETTE_GROUPS.forEach((g, i) => {
      init[g.title] = i === 0;
    });
    return init;
  });

  const toggleGroup = useCallback((title) => {
    setOpenByTitle((prev) => ({ ...prev, [title]: !prev[title] }));
  }, []);

  return (
    <aside className="icon-palette">
      <div className="icon-palette__intro">
        <strong>Library</strong>
        <p>
          Click a <strong>section title</strong> to show or hide its icons. Drag tiles onto the canvas;
          connect <em>parent</em> (bottom) to <em>child</em> (top).
        </p>
      </div>
      {PALETTE_GROUPS.map((group) => {
        const open = !!openByTitle[group.title];
        const slug = groupSlug(group.title);
        const panelId = `palette-panel-${slug}`;
        const headId = `palette-head-${slug}`;
        return (
          <section key={group.title} className="icon-palette__group">
            <button
              type="button"
              id={headId}
              className="icon-palette__group-heading"
              onClick={() => toggleGroup(group.title)}
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
                  <PaletteTile key={`${group.title}-${item.defaultLabel}`} item={item} />
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
