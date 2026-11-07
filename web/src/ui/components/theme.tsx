import { useEffect, useId, useRef, useState } from 'react';
import { ThemeIcon } from './icons';

export type ThemeId = 'breeze' | 'midnight' | 'ember' | 'paper' | 'sky' | 'sand';
export type ThemePref = 'system' | ThemeId;

export const THEMES: { id: ThemeId; name: string; mode: 'dark' | 'light'; desc: string }[] = [
  { id: 'breeze', name: 'Breeze', mode: 'dark', desc: 'Ink with mint' },
  { id: 'midnight', name: 'Midnight', mode: 'dark', desc: 'Navy with periwinkle' },
  { id: 'ember', name: 'Ember', mode: 'dark', desc: 'Charcoal with amber' },
  { id: 'paper', name: 'Paper', mode: 'light', desc: 'Warm white with teal' },
  { id: 'sky', name: 'Sky', mode: 'light', desc: 'Cool white with blue' },
  { id: 'sand', name: 'Sand', mode: 'light', desc: 'Parchment with terracotta' },
];

// Keep in sync with the inline script in index.html, which applies the theme before first paint.
const STORAGE_KEY = 'sl_theme';
const SYSTEM_DARK: ThemeId = 'breeze';
const SYSTEM_LIGHT: ThemeId = 'paper';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'system' || THEMES.some((t) => t.id === v) ? (v as ThemePref) : 'system';
  } catch { return 'system'; }
}

function systemTheme(): ThemeId {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? SYSTEM_LIGHT : SYSTEM_DARK;
}

export function resolveTheme(pref: ThemePref): ThemeId {
  return pref === 'system' ? systemTheme() : pref;
}

export function themeMode(id: ThemeId): 'dark' | 'light' {
  return THEMES.find((t) => t.id === id)?.mode ?? 'dark';
}

function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

/** Theme preference with persistence, and live tracking of the OS setting when on "system". */
export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [resolved, setResolved] = useState<ThemeId>(() => resolveTheme(readPref()));

  useEffect(() => {
    const update = () => { const id = resolveTheme(pref); setResolved(id); applyTheme(id); };
    update();
    if (pref !== 'system') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    mq?.addEventListener('change', update);
    return () => mq?.removeEventListener('change', update);
  }, [pref]);

  function setPref(next: ThemePref) {
    setPrefState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* preference just won't persist */ }
  }

  return { pref, setPref, resolved };
}

/** Top-bar button that opens a small panel of theme choices. */
export function ThemePicker() {
  const { pref, setPref } = useTheme();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const name = useId();

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Move focus to the checked option so arrow keys work straight away.
    wrapRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function option(id: ThemePref, label: string, desc: string) {
    const checked = pref === id;
    return (
      <label key={id} className={`theme-opt${checked ? ' is-checked' : ''}`}>
        <input type="radio" name={name} checked={checked} onChange={() => setPref(id)} />
        {id === 'system'
          ? <span className="theme-swatch theme-swatch-system" aria-hidden="true">
              <span data-theme={SYSTEM_LIGHT} /><span data-theme={SYSTEM_DARK} />
            </span>
          : <span className="theme-swatch" data-theme={id} aria-hidden="true"><i /><b /></span>}
        <span className="theme-opt-text">
          <span className="theme-opt-name">{label}</span>
          <span className="theme-opt-desc">{desc}</span>
        </span>
      </label>
    );
  }

  return (
    <div className="theme-picker" ref={wrapRef}>
      <button ref={buttonRef} type="button" className="btn btn-quiet btn-icon"
        aria-expanded={open} aria-controls={panelId} aria-label="Change theme" title="Theme"
        onClick={() => setOpen((o) => !o)}>
        <ThemeIcon width={18} height={18} />
      </button>
      {open && (
        <div id={panelId} className="theme-pop" role="group" aria-label="Theme">
          {option('system', 'Match system', `${THEMES.find((t) => t.id === SYSTEM_LIGHT)!.name} or ${THEMES.find((t) => t.id === SYSTEM_DARK)!.name}`)}
          {(['dark', 'light'] as const).map((mode) => (
            <fieldset key={mode} className="theme-group">
              <legend className="eyebrow">{mode === 'dark' ? 'Dark' : 'Light'}</legend>
              {THEMES.filter((t) => t.mode === mode).map((t) => option(t.id, t.name, t.desc))}
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}
