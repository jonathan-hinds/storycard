# Phase Manager Project

## Purpose

This project is an **isolated sandbox for multiplayer game-flow logic** built on top of the card module.
Use it to develop and test concepts such as:

- turn cadence across multiple phases
- upkeep and maintenance steps
- phase sequencing
- targeting and attack resolution

## Reusable module layout

The phase manager logic is now split into reusable modules so the project page is mostly a thin bootstrap:

- `shared/phase-manager/**` contains the server-side phase engine.
  - `PhaseManagerServer` owns queueing, matchmaking, turn/phase progression, validation, and match serialization.
  - This is intended to be consumed by Node services that host multiplayer card-game flow.
- `public/phase-manager/**` contains the browser-side phase client.
  - `PhaseManagerClient` owns polling, matchmaking controls, and card-module orchestration for phase UX.
  - It depends on the card module (`/public/card-game`) for rendering/interactions and treats that module as the lower-level primitive.
- `public/projects/phase-manager/src/app.js` simply wires DOM elements into `PhaseManagerClient`.

## Boundaries

- `public/card-game/**` remains the reusable card module and should stay stable.
- `public/projects/phase-manager/**` is a host/demo layer for exercising the phase module.
- `public/phase-manager/**` and `shared/phase-manager/**` are the reusable phase-management module surfaces.
- Changes in this phase-manager project should remain a layer **above** the card module.
- Avoid modifying card-module internals unless a separate card-module task explicitly requires it.

## Current state

The phase manager currently supports a deck/hand cadence suitable for turn testing:

- Each player has a 10-card deck.
- Starting hand size is 3 cards.
- At the start of each new decision phase (phase 1), each player draws 1 card automatically.
- Hand size is capped at 7 cards; additional draws are blocked while at cap.
- Turn-start draws are surfaced to the phase-manager client so player-side draw animations can be triggered without reanimating the full hand.
- UI summaries include hand, board, and remaining deck counts for both players.

The page still uses the card module through `CardGameClient`, with the phase manager now acting as the reusable multiplayer engine layer that coordinates matchmaking, phase transitions, and turn-by-turn state sync.
