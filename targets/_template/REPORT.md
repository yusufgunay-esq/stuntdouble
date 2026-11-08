# Stuntdouble Target Report: <Game Title> (<Version / Platform>)

- **Target Slug:** `<game-slug>`
- **Status:** `RECON` | `PROTOTYPE` | `VERIFIED`
- **Brain Runtime Linked:** `stuntdouble-brain-cs` | `stuntdouble-brain-cpp` | `stuntdouble-brain-lua` | `stuntdouble-brain-ts`
- **Strategy Tier Used:** `S1` | `S2` | `S3` | `S4` | `S5`
- **Default profile:** `<game-slug>` (authored per protagonist — see `profile.json`; free-form `archetype` label, **presets are only starting points**)
- **Supported Presentation Modes:** `TACTICAL`, `CINEMATIC_LIVE`, `CINEMATIC_RESOLVE`

---

## 0. Profile Derivation (No Fixed Archetype)

| Parameter | Value | Evidence it was derived from (symbol / timing / gameplay observation) |
|---|---|---|
| `archetype` (free-form label) | | |
| `preferredRange` | | |
| `aggression` | | |
| `discipline` | | |
| `cinematicFlair` | | |
| `reactionDelayMs` | | |

- [ ] Profile is **not** a byte-identical copy of a template in `schemas/profiles.json`
- [ ] `node scripts/validate-profiles.mjs <game-slug>` passes


---

## 1. Binary & Engine Fingerprint (REA Evidence)

| Property | Observed Value | REA Tool / Evidence ID |
|---|---|---|
| Engine & Runtime | | |
| Mod Loader / Injection Vector | | |
| Anti-Cheat / Online Check | Must be `None` (Single-Player Offline) | |

---

## 2. Core Seams & Optional Phase-2 Extensions

| Seam ID | Tier | Subsystem | Symbol / RVA / Signature | Discovery Method (REA) |
|---|---|---|---|---|
| `Seam.Input` | **Core (Mandatory)** | Player Controller & Motor Intent | | |
| `Seam.Perception` | **Core (Mandatory)** | Entity List, Health, Wind-Up Telegraph | | |
| `Seam.NpcAI` | **Core (Mandatory)** | Native NPC / Companion Brain Entry | | |
| `Ext.Camera` | *Optional (Phase 2)* | FOV, Orbit Transform & Time-Dilation | | |
| `Ext.Audio` | *Optional (Phase 2)* | Dynamic Combat Music / Stinger Trigger | | |
| `Ext.Encounter` | *Optional (Phase 2)* | Fast-Resolve Encounter Callbacks | | |

---

## 3. Strategy Justification & Architecture Notes

Explain why the selected strategy tier (`S1`–`S5`) was chosen and how the shared `StuntBrain` kernel interfaces with the target's state and action hooks.

---

## 4. Three-Gate Verification Ledger

- [ ] **Gate 1 — Smoke & Hand-off:** hand-over happens on the first hostile (or the user's toggle key) and returns about 2 s after the fight without frame stutter; manual input, cutscenes, menus and loading screens release control. See `adapter-checklist.md`.
- [ ] **Gate 2 — Safety Interlocks:** Autonomy cleanly pauses on cutscenes, dialogues, menus, loading screens, and player death.
- [ ] **Gate 3 — Protagonist Competence (5-Minute Live Combat):** Agent parries/dodges telegraphed (`isWindUp`) attacks, uses equipped skills, and navigates obstacles via 16-Slot Context Steering without oscillation.
- [ ] **Gate 4 — Quest & Save Integrity:** `CINEMATIC_RESOLVE` triggers native encounter completion callbacks and advances quest objectives cleanly.
