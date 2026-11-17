# Contributing to Stuntdouble

There are three doors. Pick the right one so nothing gets lost.

## 1. Game data (accepted, automatic)

Behavior profiles, adapter seams and tuning values observed in a game go to a separate data
repository: **[stuntdouble-atlas](https://github.com/yusufgunay-esq/stuntdouble-atlas)**.

- Open the **Game data submission** issue form and paste one JSON bundle.
- A deterministic validator checks schema, sizes, ranges, duplicates, URLs, paths and personal
  data. Pass: merged automatically. Fail: closed with a rejection code.
- No human reviews it, and the maintainer side runs no LLM. Data is published under CC BY 4.0 and
  always read as data, never as instructions.

## 2. Bugs and ideas (accepted)

Open an issue. For a conformance or runner failure, the command and the last lines of its output
are enough to act; a reproducible report is worth more than a patch.

## 3. Code changes (closed)

This repository is **single-author**. Pull requests that change code are not merged, and that is
deliberate: the TS kernel and the C# / C++ / Lua ports are kept in lockstep by the conformance
suite, and the attribution chain is kept in one hand. An issue that shows a real gap is more
valuable than a patch; if the gap is confirmed, the fix is made here and the issue links the
commit.

## Never send

- Game files, memory dumps, decrypted assets, decompiled code or any binary extracted from a game.
- Secrets, tokens, personal paths or any personal data.
- Code copied from a game binary or from a project whose license is incompatible with MPL-2.0.

This repository is public and distributed as a library; anything you post here is permanent.

## Licensing

- Code (`packages/`, `skills/`, `targets/`, `scripts/`, `schemas/`): MPL-2.0, see [`LICENSE`](LICENSE).
- Whitepaper and roadmap (`paper/`, `docs/`): CC BY 4.0, see [`LICENSE-CC-BY-4.0.md`](LICENSE-CC-BY-4.0.md).
- Atlas data: CC BY 4.0, see the atlas repository.
