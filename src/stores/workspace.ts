'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
type Workspace = {
  unitId: string;
  sidebar: boolean;
  setUnit: (id: string) => void;
  setSidebar: (open: boolean) => void;
};
export const useWorkspace = create<Workspace>()(
  persist(
    (set) => ({
      unitId: '',
      sidebar: false,
      setUnit: (unitId) => set({ unitId }),
      setSidebar: (sidebar) => set({ sidebar }),
    }),
    { name: 'integrar-workspace', partialize: (s) => ({ unitId: s.unitId }) },
  ),
);
type Notices = {
  items: { id: string; message: string; tone: 'success' | 'error' }[];
  add: (message: string, tone?: 'success' | 'error') => void;
  remove: (id: string) => void;
};
export const useNotices = create<Notices>((set, get) => ({
  items: [],
  add: (message, tone = 'success') => {
    const id = crypto.randomUUID();
    set((s) => ({ items: [...s.items, { id, message, tone }] }));
    setTimeout(() => get().remove(id), 6000);
  },
  remove: (id) => set((s) => ({ items: s.items.filter((n) => n.id !== id) })),
}));
