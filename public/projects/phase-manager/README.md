# Phase Manager Project

## Purpose

This project is an **isolated sandbox for game-flow logic** built on top of the card module.
Use it to develop and test concepts such as:

- turn cadence across multiple phases
- upkeep and maintenance steps
- phase sequencing
- targeting and attack resolution

## Boundaries

- `public/card/single-card/**` remains the existing card module demo and should stay stable.
- `public/projects/phase-manager/**` is where new phase-manager behavior should be added.
- Changes in this phase-manager project should be a layer **above** the card module.
- Avoid modifying card-module internals unless a separate card-module task explicitly requires it.

## Current state

The phase manager now supports a deck/hand cadence suitable for turn testing:

- Each player has a 10-card deck.
- Starting hand size is 3 cards.
- At the start of each new decision phase (phase 1), each player draws 1 card automatically.
- Hand size is capped at 7 cards; additional draws are blocked while at cap.
- Turn-start draws are surfaced to the phase-manager client so player-side draw animations can be triggered without reanimating the full hand.
- UI summaries include hand, board, and remaining deck counts for both players.

The page still boots the card interaction template through `CardGameClient`, but now layers in phase-aware draw behavior and turn-by-turn deck depletion for multiplayer phase-flow iteration.
