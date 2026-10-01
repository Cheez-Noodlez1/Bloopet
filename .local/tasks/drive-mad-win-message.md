# Drive Mad Win Message Overlay

## What & Why
When a player wins a level in Drive Mad, show the message "I won on Bloopeet" overlaid on the win screen. The game renders win/level-complete screens as webview popups, so we need to intercept that moment and inject the branding.

## Done looks like
- When a player completes a level in Drive Mad, "I won on Bloopeet" appears visibly on the win screen
- The message doesn't interfere with normal gameplay or the level-select screen

## Out of scope
- Changing the game's built-in win animation or sound
- Applying this to any other game besides Drive Mad

## Tasks
1. **Patch `webViewOpen` in `source_min.js`** — Wrap the existing `webViewOpen` function to inspect the HTML being loaded. When the content appears to be a win/level-complete screen (look for keywords like "score", "next", "well done", or similar in the HTML string), append a styled `<div>` containing "I won on Bloopeet" before writing the HTML to the iframe. The div should be positioned so it doesn't block game controls (e.g. top-center, semi-transparent background, bold text).
2. **Fallback via MutationObserver in `index.html`** — As a belt-and-suspenders approach, also add a `MutationObserver` in `games/drive-mad/index.html` that watches the `#webview_content` element. When the webview becomes visible, attempt to inject the "I won on Bloopeet" message into the iframe's document body if it isn't already there.

## Relevant files
- `games/drive-mad/webapp/source_min.js`
- `games/drive-mad/index.html`
