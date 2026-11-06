'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../atoms/button';
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const el = ref.current;
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog wide' : 'dialog'}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
    >
      <div className="dialog-header">
        <h2>{title}</h2>
        <Button variant="ghost" aria-label="Fechar" onClick={onClose}>
          <X size={20} />
        </Button>
      </div>
      <div className="dialog-content">{children}</div>
    </dialog>
  );
}
