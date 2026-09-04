---
version: alpha
name: Nyapture Quiet Archive
description: A calm, media-first dark interface for browsing and operating a personal digital library.
colors:
  primary: "#C1339E"
  primary-hover: "#D248B0"
  primary-soft: "#C1339E1E"
  on-primary: "#FFFFFF"
  background: "#1F1F29"
  background-deep: "#191922"
  surface: "#242430"
  surface-raised: "#2A2A37"
  surface-hover: "#30303E"
  appbar: "#18202EF5"
  drawer: "#1F222D"
  border: "#393947"
  border-subtle: "#30303C"
  text: "#EEEEF4"
  text-muted: "#A7A7B6"
  text-dim: "#9696A8"
  focus: "#7FB9FF"
  info: "#4C9BE8"
  success: "#45B95D"
  warning: "#E0A83B"
  danger: "#EF4D5F"
typography:
  headline-lg:
    fontFamily: "Noto Sans JP, system-ui, sans-serif"
    fontSize: 1.75rem
    fontWeight: 700
    lineHeight: 1.22
    letterSpacing: -0.025em
  headline-md:
    fontFamily: "Noto Sans JP, system-ui, sans-serif"
    fontSize: 1.25rem
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: -0.02em
  headline-sm:
    fontFamily: "Noto Sans JP, system-ui, sans-serif"
    fontSize: 1rem
    fontWeight: 700
    lineHeight: 1.4
  body-md:
    fontFamily: "Noto Sans JP, system-ui, sans-serif"
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: "Noto Sans JP, system-ui, sans-serif"
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1.55
  label-md:
    fontFamily: "Noto Sans JP, system-ui, sans-serif"
    fontSize: 0.75rem
    fontWeight: 600
    lineHeight: 1.3
  label-sm:
    fontFamily: "Noto Sans JP, system-ui, sans-serif"
    fontSize: 0.6875rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0.04em
rounded:
  none: 0px
  sm: 7px
  md: 11px
  lg: 15px
  full: 9999px
spacing:
  none: 0px
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 20px
  6: 24px
  8: 32px
  10: 40px
  12: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    padding: 0.75rem
    height: 2.5rem
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    padding: 0.75rem
    height: 2.5rem
  icon-button:
    backgroundColor: transparent
    textColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
    size: 2.5rem
  input:
    backgroundColor: "{colors.background-deep}"
    textColor: "{colors.text}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: 0.75rem
    height: 2.5rem
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: 1rem
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: 1.25rem
---

# Nyapture Quiet Archive

## Overview

Nyapture is a quiet, media-first archive. The interface should feel calm and dependable while supporting information-dense search, download, and system-management workflows. Artwork and operational state are the primary visual signals; surrounding chrome stays restrained.

The product uses a dark neutral foundation with one magenta interaction accent. Density is compact but never cramped, and status information must remain legible without relying on color alone.

## Colors

- Deep neutral backgrounds keep long browsing and reading sessions comfortable.
- Magenta is reserved for the current location, the primary action, selection, and focused product moments.
- Blue, green, amber, and red communicate information, success, warning, and danger respectively. Each status also needs an icon or label.
- `text-dim` is the lowest permitted text tone. Do not introduce darker text for captions or disabled-looking metadata.
- Layer surfaces by tone before adding shadows. Borders should be subtle but visible at every supported viewport.

## Typography

- Use `Noto Sans JP` with the system sans-serif stack as fallback. The UI remains usable when the web font cannot be loaded.
- Page titles use `headline-lg`; section and dialog titles use `headline-md` or `headline-sm`.
- Controls and metadata use the label scale. Avoid text below `label-sm` unless it is nonessential decoration.
- Use tabular numerals for page counts, progress, timestamps, storage, and operational metrics.
- Keep headings concise. Long book titles may wrap to two lines or truncate only when an adjacent action requires stable height.

## Layout

- Use a fluid content area with fixed maximum widths for scanability.
- Desktop uses a persistent navigation drawer; compact layouts use an overlay drawer.
- All spacing follows the 4px base scale. Prefer 8px between tightly related controls, 16px inside compact surfaces, and 24px between major groups.
- Pages share a consistent sequence: page identity, relevant status/actions, filters, primary content, then pagination or supporting detail.
- Responsive changes follow four conceptual ranges: mobile, tablet, compact desktop, and wide desktop. A page may omit a breakpoint only when its layout does not change there.

### Layout contract

`tokens.css` is the implementation of this contract. Keep the values below as the
single source of truth when adding or changing page layouts.

#### Containers

- `--container-wide`: `1520px` for Search, Dashboard overview, and Download Manager.
- `--container-standard`: `1360px` for Dashboard detail and other management views.
- `--container-reader`: `760px` for the Viewer image column.
- Viewer dock (`820px`), details sheet (`980px`), and dialog widths remain local
  component dimensions rather than global page containers.

#### Responsive ranges

- Mobile: `<640px` — overlay drawer, 16px page gutter, 56px topbar.
- Tablet: `640–879px` — overlay drawer, 24px page gutter, 56px topbar.
- Compact desktop: `880–1199px` — persistent 224px drawer, 32px page gutter,
  64px topbar.
- Wide desktop: `>=1200px` — persistent 248px drawer, 40px page gutter,
  64px topbar.

The only responsive boundaries are `640px`, `880px`, and `1200px`. CSS is
mobile-first and uses `min-width` media queries at those boundaries.

#### Semantic spacing

- `--layout-page-gutter`: `16px / 24px / 32px / 40px` from mobile through wide.
- `--layout-page-block-start`: `24px / 24px / 32px / 32px` from mobile through wide.
- `--layout-page-block-end`: `32px / 40px / 48px / 48px` from mobile through wide.
- `--layout-section-gap`: `24px` between major page groups.
- `--layout-grid-gap`: `16px` between repeated content items.
- `--layout-control-gap`: `8px` between related controls.
- `--layout-tight-gap`: `4px` for tightly coupled labels and indicators.
- `--shell-content-offset`: `0px / 0px / 224px / 248px` from mobile through wide.

Margins, padding, gaps, and structural insets must use this 4px scale. One-pixel
borders, outlines, shadows, transforms, aspect ratios, safe-area insets,
accessibility clipping offsets, and intrinsic image or icon dimensions are
intentional exceptions.

## Elevation & Depth

Depth comes from tonal layers and thin borders. Use raised shadows for floating dialogs, menus, sticky controls, and hover feedback only. Cards at rest should not appear detached from the application background.

Backdrop blur belongs to persistent navigation or modal context, not ordinary content cards. Motion should be brief and functional; respect `prefers-reduced-motion` globally.

## Shapes

Interactive controls use the small radius, content cards and dialogs use the medium radius, and major overview surfaces may use the large radius. Pills are limited to status badges, counts, and compact filters. Avoid mixing arbitrary radii within one component family.

## Components

- Buttons share one height and typography scale. A screen should normally have one visually primary action.
- Icon buttons require an accessible name and a visible focus ring. Destructive icons use the danger palette only when the action is available.
- When an icon alone sufficiently conveys the action, prefer an icon-only button without visible explanatory text. Always provide the action name through `aria-label`.
- Do not add decorative captions, eyebrow labels, or explanatory microcopy that repeats a heading, value, icon, control, or nearby context. Add visible labels only when they prevent ambiguity or are necessary to understand or operate the interface; required accessible names remain mandatory.
- Dialogs share the same frame, backdrop, header, scrollable body, and footer behavior. Focus returns to the trigger after closing.
- Inputs pair a visible label with helper or error text. Focus and invalid states must not be communicated by color alone.
- Status badges use a shared semantic tone model. Domain-specific book statuses may extend it without redefining the base palette.
- Loading, error, and empty states use a common state panel. Keep the title actionable and the description concise.
- Book covers and reader pages remain visually dominant; operational decoration must not obscure artwork.

### Permanent UI Organization Contract

Separate standard UI from domain UI. Manage `Button`, `IconButton`, `StatePanel`, and
regular `Dialog` as shared primitives that do not reference API/routing/feature state.
Page-level actions in Search, AppShell, Dashboard, and Download Manager are standard UI.
Viewer sheets, overlays, and handles, DownloadCard-specific operations, and tag/cover
palettes are domain exceptions owned by each feature.

Standard control density is default `40px` and compact `32px`; inline padding is
`12px` and `8px`, respectively, and icon sizes are `18px` and `16px`, respectively.
Limit variant/tone combinations to `solid` (accent/danger/success/warning), `outline`
(neutral/accent/danger/success/warning), and `ghost` (neutral/accent/danger). The
default `Button` is outline/neutral/default, and `IconButton` is ghost/neutral/default.
Standard Dialog footers are right-aligned by default; only Dialogs that need split alignment
or a similar arrangement may define a local layout in the caller. Do not use legacy
class/token aliases; feature CSS must reference canonical tokens only.

Apply the wide three-column layout in Dashboard detail only to the data displays using
`grid`, `metrics`, `cards`, and `definition-grid`. Keep `field-grid` and `form-grid` at
a maximum of two columns. Viewer and DownloadCard exceptions must not change their
information density or interaction model merely to resemble standard primitive visuals.

### Standard Dialog lifecycle

Standard Dialog uses controlled `open` and `useNativeDialog`; the caller owns its width,
form, ARIA label/ID, and pending state. The `reason` in `onRequestClose(reason)` is the
union of `escape`, `backdrop`, `close-button`, `submit`, and `programmatic`; a caller that
returns `true` updates `open=false` in the same event. Only the hook executes native
`showModal()`/`close()`. Always call `preventDefault` on `cancel`; accept only a backdrop
pointerdown→click sequence that began outside the panel, and discard the state on
`pointercancel`. If the caller rejects an unexpected native close, clear the reason and
reopen without running `onAfterClose` or restoring focus. Run `onAfterClose` exactly once
only for an accepted close; for an explicit close, restore focus to `resolveRestoreFocus`
(the element focused before opening when unspecified). `dismissible=false` rejects Escape,
backdrop, and close-button dismissal. The caller specifies `resolveRestoreFocus` only when
a submit or programmatic close needs a focus target. The caller or `useId` helper creates
unique `aria-labelledby`/`aria-describedby` IDs. Viewer sheet is outside this contract.

Use `StatePanel` only for loading/error/empty states at the page or primary content-region
level. Do not use it for inline errors, partial failures, empty table states, or Viewer
overlays; keep them as local states within each domain.

Literal values are permitted only for 1px borders/outlines, shadows/transforms, aspect
ratios, safe-area insets, accessibility offsets, image/icon-specific dimensions,
cover/tag palettes, status-specific badges, progress widths, Viewer sheets/docks and
reader chrome, DownloadCard-specific operations, and Dashboard operation-identifying
icons. Use tokens for spacing, standard radii, breakpoints, and global state colors.
`tag-chip.css` is included in this exception as the owner of the tag palette.

### Phased Migration and Verification Limits

Build each UI migration phase independently without changing the API, routing, state, DOM
order, focus order, or pending conditions. Remove temporary migration ledgers when complete,
leaving only permanent contracts and exceptions in this document. Build, TypeScript, and
static searches can detect contract violations, but do not guarantee runtime focus, Dialog
lifecycle, responsive rendering, contrast, or visual equivalence of the CSS cascade.

## Do's and Don'ts

- Do use semantic tokens instead of literal colors in component CSS.
- Do keep normal-size text at WCAG AA contrast or better.
- Do colocate page-specific layout with its page and keep shared primitives independent of feature state.
- Do preserve keyboard access, focus restoration, reduced motion, and descriptive labels.
- Don't place API calls, routing decisions, and large presentational trees in the same component.
- Don't create page-local versions of buttons, dialogs, progress bars, or status badges without a documented domain need.
- Don't use magenta as general decoration; it represents interaction and selection.
- Don't introduce a new spacing, radius, or breakpoint when an existing scale value works.
