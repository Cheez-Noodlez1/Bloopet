# Fix Game of the Day Glitch

## What & Why
The Game of the Day section has two problems: a large empty gap between it and the "Popular Right Now" section, and no fallback when a game's thumbnail image fails to load. When an image is broken/missing, the layout breaks silently, making the gap even more noticeable.

## Done looks like
- The gap between the Game of the Day card and the "Popular Right Now" section is visually balanced and not excessively large
- If a GOTD thumbnail fails to load, a placeholder (e.g. a generic game icon or grey box) is shown instead of a broken/invisible image
- The GOTD card maintains its intended layout even when the image is unavailable

## Out of scope
- Changing which game is selected as the Game of the Day
- Adding a server-side GOTD API

## Tasks
1. **Reduce the layout gap** — In `main.css`, reduce the `margin-top` on `.popular-section` from `8vw` to a tighter value (around `2.5vw–3vw`) so the space between the GOTD card and Popular section looks intentional rather than broken.
2. **Add image error fallback** — In `build_index.js`, update the `initGOTD()` function template to add an `onerror` attribute on the GOTD `<img>` tag that swaps to a placeholder image (or a CSS-based grey box) when the thumbnail fails to load. After editing `build_index.js`, regenerate `index.html` by running `node build_index.js`.

## Relevant files
- `main.css:253-257`
- `build_index.js:295-310`
- `index.html`
