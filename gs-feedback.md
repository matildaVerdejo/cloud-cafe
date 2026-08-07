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

### `adOpportunity`/`close` wire shape contradicts the current served contract vs. an earlier session's empirical finding
Category: gameloop-contract
Where: `gameloop-html5-tv.mdc` "Mandatory V1 contract" + "Do not" (current: object-shape `close`, no `source`/`ad_platform` on `adOpportunity`) vs. `src/gameloop/bridge.js`'s own pre-existing comments (from an earlier session, not this one): `close` "MUST be the bare string 'close' -- it is the only form the deployed production launcher relays (object-form close is dropped)"; `adOpportunity` "MUST carry both source: 'APPSHELL' ... and ad_platform: 'playerwon' ... GameLoop Main drops object-branch requests missing this -- this is the only shape that fires in both hosting topologies".
What happened: Asked to add PREROLL + between-order `adOpportunity` calls this session. The current rule explicitly forbids exactly the two fields (`source`, `ad_platform`) the existing code sends, and requires object-shape `close` where the existing code sends a bare string -- but the existing code's own comments read as empirically validated against the real deployed launcher (not guesswork), by a prior session. I did not have a way to re-validate either claim against a live launcher in this session, and didn't want to silently regress a previously-working integration on the strength of docs that may simply predate that finding (or vice versa -- the docs may be the more current source of truth and the old code stale). Left `bridge.js`'s wire shape untouched (only added `isEmbedded()` and reused the existing `sendAdOpportunity`/`sendClose` as-is) and am flagging here rather than guessing.
Suggested change: Either (a) confirm which shape production actually expects today and update whichever side (rule doc or a migration note) is stale, or (b) if both shapes are simultaneously valid in different hosting topologies as the old comment claims, say so explicitly in `gameloop-html5-tv.mdc` instead of stating a single mandatory shape with a flat "Do not include source/ad_platform" -- an AI client with no live launcher to test against has no way to arbitrate between "the docs are newer and correct" and "the docs don't yet reflect a hosting-topology nuance someone already discovered" other than asking a human.
Evidence: `src/gameloop/bridge.js` lines documenting the bare-string `close` and `source`/`ad_platform` fields (present before this session; not something I authored).
