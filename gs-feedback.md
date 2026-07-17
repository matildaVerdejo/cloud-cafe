# GS feedback ledger — cloud-cafe

GS/MCP version: 0.2.21
Client: Claude (Cowork), claude-sonnet-5
Build: cloud-cafe, React 19 / Create React App (react-scripts 5.0.1), existing-game graft

## Entries

### React/CRA is not a represented runtime lane
Category: new-area
Where: gameloop-existing-game-workflow SKILL.md "Canonical patterns per runtime lane" table (Lightning/Solid, Phaser, WebGL 1, WASM, vanilla JS only)
What happened: The seed game (cloud-cafe) is a Create React App (React 19, react-scripts, DOM-rendered, no canvas/engine). None of the five canonical lanes match. The skill says to "surface that gap as a finding rather than improvising a pattern" for unrepresented lanes (it names Unity WebGL/Roku/tvOS as examples), but React is a mainstream HTML5 DOM lane that seems likely to recur for existing-game grafts, distinct from those out-of-scope examples.
Suggested change: Add a "DOM component framework (React/Vue/Svelte)" lane note to the existing-game-workflow table, even if it just says "treat as vanilla-JS DOM lane: apply tv-engine-vanilla-js-workflow's mock-host template verbatim (translated to plain JS/CRA build if the seed has no TS/Vite), apply DOM/CSS focus rules from tv-platform-html5.mdc, author the V1 bridge as a plain module called from the framework's root component." That is the interpretation used here absent explicit guidance.
Evidence: n/a (proceeded by treating the seed as the DOM/CSS-UI case in tv-platform-html5.mdc "Applicability" + vanilla-JS mock host as canonical shape for the graft-authored mockhost files only).
