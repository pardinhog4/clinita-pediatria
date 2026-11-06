'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal, Trash2 } from 'lucide-react';
export function SandboxSession({
  selected,
  onSelect,
  onDelete,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div
      ref={ref}
      className={'sandbox-session' + (selected ? ' selected' : '')}
      onContextMenu={(e) => {
        e.preventDefault();
        setOpen(true);
      }}
    >
      <button className="sandbox-session-select" onClick={onSelect}>
        {children}
      </button>
      <button
        className="sandbox-session-more"
        aria-label="Ações da conversa"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div className="sandbox-session-menu" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={15} />
            Excluir conversa
          </button>
        </div>
      )}
    </div>
  );
}
