# Browser end-to-end checks (`tools/e2e`)

Plays the real game in a headless Chrome with real mouse / keyboard input, takes screenshots and
fails on console errors, uncaught exceptions or broken flows. Zero dependencies: a small Chrome
DevTools Protocol driver over Node's built-in `WebSocket`.

```
npm run e2e                         # every scenario (~4 min)
npm run e2e -- combat siege         # scenarios whose name contains one of the words
E2E_OUT=/tmp/shots npm run e2e      # screenshot directory (default tools/e2e/out)
E2E_VERBOSE=1 npm run e2e           # echo the page console
E2E_DAYS=60 npm run e2e -- longgame # longer AI game
CHROME=/usr/bin/chromium npm run e2e   # native Linux / macOS browser
npm run e2e:session                 # interactive session, see session.mjs (curl commands)
```

Node 20 needs `--experimental-websocket` (the npm scripts pass it). The runner starts
`tools/serve.mjs` on a free port itself; `E2E_SERVER=http://127.0.0.1:8080` uses a running server.
Output: `<out>/*.png`, `<out>/report.json` (results, metrics, screenshot list); exit code 1 on failure.

## Files

| file | role |
|---|---|
| `browser.mjs` | `launch()` → `{ page, close }`; `Page`: `goto eval waitFor click clickEl box key type wheel screenshot setViewport`, console / exception / log capture |
| `relay.ps1` | WSL2 only: TCP relay run on Windows (see below) |
| `pageHelpers.js` | injected as `window.e2e`: `newGame(opts)`, `state() me() myHeroes()`, `adv()` / `combat()` (screen controllers), `tileClient(x,y)`, `hexClient(x,y)`, `battle()`, `dialogs()`, `frames(ms, step)` (rAF timing), `mem()` |
| `run.mjs` | runner + test context `t` (`open button tile hex ackDialogs checkDialogFit shot check metrics`) |
| `scenarios.mjs` | the scenarios |
| `session.mjs` | long-lived browser + tiny HTTP command server for exploratory poking |

## Scenarios

`menu` (main menu, encyclopedia incl. animated creature, options, credits) · `adventure` (New Game by
clicks with a typed seed, pick up a resource, hero / town screens, build, recruit, kingdom, 4 days vs AI) ·
`combat` (walk into a monster: cast, shoot, wait, defend, move, auto, result) · `quickcombat` · `siege`
(attack an enemy town: siege battle, capture, victory dialog) · `defend` (a computer hero attacks our town:
"under attack" message, we fight as defender, the turn goes on) · `services` (tavern hire, marketplace
trade, mage guild / fort windows, hero exchange, level-up dialogs) · `scenarios` (all handcrafted maps load
and end a turn) · `saveload` (quicksave Ctrl+S → Load Game screen → load; export; hotseat curtain) ·
`longgame` (28 days vs AI) · `perf` (XL + underground, 1 human + 3 AI: generation time, frame times while
scrolling, end-turn time, JS heap) · `resize` (5 window shapes, no page scroll, adventure shortcuts) · `editor` (map
editor: new map, paint / road strokes, town + hero for 2 players, object browser, undo / redo, save, validate, play
the map, listed under New Game's custom maps) · `campaign` (main menu -> Campaigns -> difficulty -> briefing with a
bonus choice -> adventure with the campaign hero -> forced victory -> the next briefing).

`checkDialogFit` (called on every screenshot / acknowledged dialog) reports dialogs whose content is
clipped or that leave the stage (`metrics.clippedDialogs`).

## WSL2 notes

The default on WSL is Windows Chrome (`/mnt/c/Program Files/Google/Chrome/...`, Edge as fallback).
With NAT networking two things do not work directly, so the driver works around them:

- Chrome's DevTools port listens on the Windows loopback only. `relay.ps1` (started through
  `powershell.exe`) keeps a standby connection to a listener of the driver (Windows reaches WSL as
  `localhost`), and on demand dials Chrome and pumps bytes both ways.
- The Windows → WSL path drops requests under load (`ERR_NO_BUFFER_SPACE`, `ERR_CONNECTION_RESET` on
  module imports). The page therefore never fetches from the network: CDP `Fetch` interception hands every
  request for the app origin to the driver, which fetches it from the static server and fulfils it.

Profiles go to `C:\Temp\h3e2e-<pid>-<time>`; browsers / profiles of dead drivers are cleaned up on the
next launch.
