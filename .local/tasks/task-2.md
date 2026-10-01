---
title: Expand portal to 200 games
---
# Expand Portal to 200 Games

## What & Why
Add 145 new games to bring the portal from 55 to 200 total, using a mix of games that already have thumbnails in the images/ folder and a curated batch of quality external browser games from sources not previously imported.

## Done looks like
- Header stat reads "200 GAMES"
- All new games appear in the grid with working thumbnails and correct category filters
- New external games open in a new tab with the external badge
- Strategy filter button is restored (new batch will include strategy games)
- `node build_index.js` reports "Done. Games: 200"

## Out of scope
- Re-adding the leereilly/games repo or the JS13KGames repo (those were explicitly removed)
- Locally hosting new game files (all additions are external links)

## Tasks

1. **Wire up the 11 games that already have thumbnails** — The following PNGs exist in images/ but are not in the games array: aceattorney, animalcrossingwildworld, animatorvsanimation, blockpost, bloonstd5, fnaf, happywheels, redball4, stormthehouse2, superhot, trollfacequest. Add each to the games array and categories object in build_index.js with a working external URL and correct category. (Total: 55 + 11 = 66)

2. **Curate and add 134 more external games** — Research and add 134 quality browser games from fresh sources: well-known .io games (Agar.io, Diep.io, Slither.io, Krunker.io, Shell Shockers, Skribbl.io, Wormate.io, etc.), popular HTML5 titles from itch.io free browser games, Phaser community showcases, OpenGameArt browser games, and individually well-known game developer sites. For each: verified working URL, SVG thumbnail generated via generate_ext_thumbs.js, correct category. Aim for good spread across Arcade, Puzzle, Adventure, Strategy, Platform, Racing, Sports, Simulation categories. (Total: 66 + 134 = 200)

3. **Restore Strategy filter button and rebuild** — Add the Strategy category filter button back to the filter bar in build_index.js (the new batch will include strategy games). Run `node build_index.js` and verify the count = 200. Run `node --check server.js` and restart the workflow.

## Critical rules
- NEVER edit index.html directly — always edit build_index.js then run `node build_index.js`
- Apostrophes in JS template strings → use `\u2019`, never raw `'`
- External games: `ext:true` + `url:'...'` in games array; categories object entry required for every game
- Verify `node --check server.js` passes before restarting

## Relevant files
- `build_index.js`
- `generate_ext_thumbs.js`
- `images/` (existing thumbnails)
- `data/plays.json`