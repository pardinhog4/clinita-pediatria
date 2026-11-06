'use client';
import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { readThemePreference, setThemePreference, type ThemePreference } from '@/lib/theme';
const options: [ThemePreference, string, typeof Sun][] = [
  ['light', 'Tema claro', Sun],
  ['system', 'Seguir o sistema', Monitor],
  ['dark', 'Tema escuro', Moon],
];
export function ThemeSwitcher({ className = '' }: { className?: string }) {
  const [pref, setPref] = useState<ThemePreference | null>(null);
  useEffect(() => setPref(readThemePreference()), []);
  const choose = (p: ThemePreference) => {
    setThemePreference(p);
    setPref(p);
  };
  return (
    <div className={'theme-switcher ' + className} role="radiogroup" aria-label="Aparência">
      {options.map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          aria-label={label}
          title={label}
          className={pref === value ? 'active' : ''}
          onClick={() => choose(value)}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}
