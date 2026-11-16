# Goal: build LoopBoard, a local-first kanban board that runs in the browser.

## Must have

- Three columns (To do, Doing, Done) with add, edit and delete for cards (title, optional note, optional due date).
- Move cards by drag and drop **and** by keyboard (accessible: focus order, ARIA labels, visible focus).
- A work-in-progress limit per column, set by the user; the column warns when it is over the limit.
- Everything persists in `localStorage`; export the board to JSON and import it back.
- Light and dark themes, following the system setting with a manual toggle.
- Works on a phone-width screen.

## Look and feel

This is a launch requirement, not polish: LoopBoard must look like a 2026 product (think Linear, or Trello today), at desktop and phone width, in light and dark. A screen that looks like a form on a page fails the goal even if every feature works.

- **Design system:** Tailwind CSS v4 (through `@tailwindcss/vite`), with the theme tokens defined once in CSS (`@theme`): Inter (self-hosted through `@fontsource-variable/inter`) with a system UI fallback, a type scale, spacing, radius, subtle layered shadows, and colour roles for light and dark (surface, raised surface, text, muted text, border, accent, warning, danger). Icons from `lucide`. No other UI libraries.
- **Board:** a quiet board background; columns as rounded panels, each with its own accent colour (a thin top bar or dot) and a header showing the name and a count badge. Cards are raised, rounded surfaces with comfortable padding, no hard borders, the title prominent and the note and due date muted below it; an overdue date shows in the danger colour.
- **Cards:** hovering a card lifts it slightly and shows a drag handle and a "…" menu (Edit, Delete); no row of buttons on every card. While dragging, the card tilts slightly and the drop position is shown. Keyboard moves work from the focused card (and its menu offers "Move to …").
- **Adding a card:** an "Add card" button at the foot of each column opens a compact inline form (title, then optional note and due date); Enter saves, Escape cancels, and the form closes again.
- **WIP limits:** set from the column's "…" menu, not from a number box in every header. The header badge shows count / limit and turns to the warning colour when over, with a short warning line under the header.
- **Header:** the app name with a small logo mark; Import and Export in a menu (Import is a button; the native file input is never visible); the theme toggle is an icon button (system, light, dark).
- **Empty states:** an empty column shows a short, friendly hint with an icon, not blank space; an empty board on first load shows three sample cards the user can delete.
- **Motion:** short transitions for hover, menus, opening forms and moving cards, all turned off under `prefers-reduced-motion`.
- **Phone width:** columns scroll sideways with snap (or stack), nothing cut off, touch targets at least 44 px.
- `scripts/visual-setup.mjs` (used by the loop's screenshots) fills the board with a few sample cards, one column over its WIP limit and one card overdue, so the screenshots show a working board.

## Engineering

- Vite + TypeScript, no component framework (no React, Vue or Svelte); styling as above. Relative asset paths (Vite `base: './'`), so the same build works locally and on Pages. `npm run preview` serves the build. Unit tests with Vitest for the board logic; one Playwright smoke test (add a card, move it, reload, it is still there).
- GitHub Actions CI running lint, unit tests and the smoke test on every PR.
- Deploy to GitHub Pages from `main`.

**Not in scope:** accounts, a backend, sync between devices, multiple boards.

**Done when:** every issue is closed, CI is green on `main`, and the board is live on GitHub Pages.
