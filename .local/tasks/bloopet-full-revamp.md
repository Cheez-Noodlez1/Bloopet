# Bloopet Full Revamp

## What & Why
Complete overhaul of Bloopet's visual design and code quality. The site currently has a serviceable dark/gaming aesthetic but uses hardcoded colors throughout a 2,163-line CSS file, buries ~3,000 lines of JavaScript inside index.html, and has several clunky UI elements (redundant script.js, the over-engineered multi-game windowing system, vw-unit sizing that breaks at odd viewport widths). The revamp modernizes the look, cleans up the architecture, and polishes the user experience without removing any core features.

## Done looks like
- A fresh visual identity: a new design direction chosen by the executor (e.g., premium dark arcade, warm retro pixel, or sleek minimal — executor's creative call), consistently applied via CSS custom properties instead of scattered hardcoded hex values.
- All JavaScript extracted from index.html into a clean external file (e.g., `js/app.js`), leaving index.html as lean markup only.
- The multi-game windowing system removed or simplified to a single focused game view, reducing complexity and performance overhead.
- Game cards have a polished redesign: clearer thumbnails, smoother hover states, legible rating and play-count display.
- The navbar, stats bar, filter bar, GOTD section, Surprise Me widget, and modals all share a cohesive updated style.
- The redundant root-level `script.js` removed.
- Mobile experience is clean and consistent across breakpoints.
- The site still functions fully: search, filter, favorites, ratings, leaderboard, multiplayer, auth, settings, game submission all work correctly.

## Out of scope
- Adding new features or game titles.
- Backend changes (server.js, db.js, API routes).
- Changes to how games themselves are loaded or embedded.
- Changing the Bloopet name, logo, or mascot.

## Tasks
1. **Design system foundation** — Introduce CSS custom properties for all colors, spacing, typography, shadows, and border-radii in main.css. Choose a fresh visual direction (executor's creative call) and apply it consistently. Replace all hardcoded hex values with the new variables.

2. **Navbar, stats bar, and filter bar redesign** — Restyle the fixed navbar, announcement banner, stats bar, and filter/sort bar using the new design system. Improve legibility, spacing, and active/hover states on filter buttons.

3. **Game card redesign** — Redesign `.game-card` with improved thumbnail proportions, cleaner title/metadata layout, and polished hover animations. Improve the star rating and play-count display.

4. **Homepage sections redesign** — Restyle the Game of the Day panel, Surprise Me widget, Popular section, Recently Played row, and the fun widgets/trivia area using the new design system.

5. **Modals and overlays redesign** — Restyle all modals (Auth, Settings, Submission, Profile, Leaderboard, Multiplayer) to match the new design language: consistent padding, typography, input fields, and button styles.

6. **JavaScript extraction and cleanup** — Move all inline JavaScript from index.html into `js/app.js`. Remove the redundant root-level `script.js`. Simplify or remove the multi-game windowing system. Ensure all event listeners, search, filter, favorites, ratings, and tracking still work correctly.

7. **Mobile polish and final cleanup** — Audit and fix all responsive breakpoints with the new design. Clean up leftover dead CSS in main.css. Verify the full user flow (search, play, favorite, rate, auth, settings) works end-to-end.

## Relevant files
- `index.html`
- `main.css`
- `script.js`
- `js/main.js`
- `server.js`
