# Streambree web — design brief

## Who and what
A small invited group sharing media between their own devices. Core tasks, in order of
frequency: **join a stream with a code**, **start a 1:1 stream**, **broadcast to a
channel**, **browse shared files**. Every screen should get the person to the next step
in one obvious action.

## Identity
The **room code** is the product's signature: a large, chunked Space Mono code on a
"ticket" surface, with a three-step connection track (Waiting → Connecting → Live)
underneath. The same mono voice labels status, roles, codes and numbers everywhere.

## Layout
- Top bar with four destinations: Join · Stream · Channels · Files. Account actions right.
- Widths: `--w-narrow` 440px (auth, invite), `--w-form` 680px (setup flows),
  `--w-wide` 1120px (channel detail, files).
- Setup flows are a single column of numbered sections; the primary action closes the
  form. Lists use divided rows, not grids of cards.

## Typography
- Sans: Instrument Sans — body, headings, controls.
- Mono: Space Mono — labels, status pills, badges, codes, counters.
- Scale (rem): 0.75 · 0.8125 · 0.875 · 1 · 1.125 · 1.375 · 1.75 · 2.25.
  Body 1rem / 1.55. Headings 1.2, tracking −0.02em. Prose max 62ch.

## Spacing
4px base: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 (`--sp-1`…`--sp-8`).
Inside panels 24px; between panels 16px; between page sections 32px.

## Color roles
background, raised surface, sunken field, hairline border; text / muted / faint;
accent for primary actions and connected state; live; warn; danger; info.
Focus ring = accent at 2px with offset.

## Themes
Six themes, chosen from the top-bar theme button (or "Match system", which picks
Paper or Breeze from the OS setting). Saved per device in `localStorage` (`sl_theme`)
and applied before first paint by the inline script in `index.html`.

| Theme | Mode | Feel |
|-------|------|------|
| Breeze (default dark) | dark | ink with mint |
| Midnight | dark | navy with periwinkle |
| Ember | dark | charcoal with amber |
| Paper (default light) | light | warm white with deep teal |
| Sky | light | cool white with blue |
| Sand | light | parchment with terracotta |

Each theme sets ~25 base colors in `styles.css`; soft/line tints, overlays and
shadows are derived with `color-mix`, so a new theme only needs the base set.
Every theme keeps text, muted text, faint text, accent and status colors at
≥ 4.5:1 contrast against the surfaces they sit on. Video areas stay black, and the
file preview lightbox always uses a dark palette.

## Radius
6px controls · 10px panels · 16px stage/dialogs · pill for status.
