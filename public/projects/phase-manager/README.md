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

The page currently boots the existing card interaction template through `CardGameClient` so multiplayer phase logic (decision and commit phases) can be added incrementally in this project without coupling it to the original single-card page.
