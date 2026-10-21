import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconChevronLeft, IconX } from './icons';
import { goBack } from './router';

export function Topbar({ title, back, right }: { title?: ReactNode; back?: string; right?: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header className={`topbar${scrolled ? ' scrolled' : ''}`}>
      {back !== undefined && (
        <button className="back" onClick={() => goBack(back)} aria-label="Regresar">
          <IconChevronLeft size={24} />
        </button>
      )}
      <h1>{title}</h1>
      {right}
    </header>
  );
}

export function Sheet({ title, onClose, children, actions }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          {actions}
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconX size={20} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      {message && <p className="muted" style={{ marginTop: 0 }}>{message}</p>}
      <div className="stack">
        <button
          className={`btn block big ${danger ? 'danger' : 'primary'}`}
          onClick={async () => {
            await onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
        <button className="btn block" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </Sheet>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)} role="tab" aria-selected={o.value === value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Textarea que guarda al salir del campo. */
export function AutoSaveText({ value, onSave, placeholder, rows = 4 }: { value: string; onSave: (v: string) => void; placeholder?: string; rows?: number }) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <textarea
      className="textarea"
      rows={rows}
      value={text}
      placeholder={placeholder}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (text !== value) onSave(text);
      }}
    />
  );
}

// ───────── Avisos breves ─────────

let toastMsg: string | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toastListeners = new Set<() => void>();

export function toast(msg: string, ms = 2200) {
  toastMsg = msg;
  toastListeners.forEach((l) => l());
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMsg = null;
    toastListeners.forEach((l) => l());
  }, ms);
}

export function ToastHost() {
  const msg = useSyncExternalStore(
    (cb) => {
      toastListeners.add(cb);
      return () => toastListeners.delete(cb);
    },
    () => toastMsg,
  );
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}
