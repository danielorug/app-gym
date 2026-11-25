import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconGrip } from './icons';

interface DragState {
  from: number;
  to: number;
  dy: number;
}

/**
 * Lista que se reordena arrastrando la agarradera (☰). Al soltar llama `onReorder` con el nuevo orden.
 * Mientras se guarda, muestra el orden nuevo para que la lista no "brinque" de regreso.
 */
export function ReorderList<T>({
  items,
  keyOf,
  render,
  onReorder,
  label,
}: {
  items: T[];
  keyOf: (item: T) => string;
  render: (item: T, index: number) => ReactNode;
  onReorder: (next: T[]) => void;
  label: (item: T) => string;
}) {
  const [pending, setPending] = useState<T[] | null>(null);
  // El estado del arrastre vive en una ref (los eventos llegan más rápido que los renders);
  // `drag` es solo la copia para pintar.
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const geo = useRef<{ startY: number; mids: number[]; shift: number } | null>(null);
  const shown = pending ?? items;

  useEffect(() => setPending(null), [items]);

  const onDown = (i: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button > 0) return;
    e.preventDefault();
    const rects = rows.current.slice(0, shown.length).map((el) => el!.getBoundingClientRect());
    const gap = rects.length > 1 ? rects[1].top - rects[0].bottom : 8;
    geo.current = { startY: e.clientY, mids: rects.map((r) => r.top + r.height / 2), shift: rects[i].height + gap };
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { from: i, to: i, dy: 0 };
    setDrag(dragRef.current);
  };

  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || !geo.current) return;
    const dy = e.clientY - geo.current.startY;
    const center = geo.current.mids[d.from] + dy;
    const to = geo.current.mids.filter((m, k) => k !== d.from && m < center).length;
    dragRef.current = { ...d, dy, to };
    setDrag(dragRef.current);
  };

  const onUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    onMove(e); // por si el último movimiento no llegó antes de soltar
    const d = dragRef.current;
    if (!d) return;
    const { from, to } = d;
    dragRef.current = null;
    setDrag(null);
    geo.current = null;
    if (from === to) return;
    const next = [...shown];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setPending(next);
    onReorder(next);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= shown.length) return;
    const next = [...shown];
    [next[i], next[j]] = [next[j], next[i]];
    setPending(next);
    onReorder(next);
  };

  const offset = (i: number): number => {
    if (!drag || !geo.current) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -geo.current.shift;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return geo.current.shift;
    return 0;
  };

  return (
    <div className={`reorder${drag ? ' dragging' : ''}`}>
      {shown.map((item, i) => (
        <div
          key={keyOf(item)}
          ref={(el) => {
            rows.current[i] = el;
          }}
          className={`reorder-row${drag?.from === i ? ' lifted' : ''}`}
          style={{ transform: offset(i) ? `translateY(${offset(i)}px)` : undefined }}
        >
          <button
            className="reorder-handle"
            aria-label={`Arrastrar para mover: ${label(item)}`}
            onPointerDown={onDown(i)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') move(i, -1);
              if (e.key === 'ArrowDown') move(i, 1);
            }}
          >
            <IconGrip size={20} />
          </button>
          <div className="reorder-body">{render(item, i)}</div>
        </div>
      ))}
    </div>
  );
}
