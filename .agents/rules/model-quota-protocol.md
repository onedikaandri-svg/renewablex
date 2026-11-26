---
trigger: always_on
---

# Model Selection & Quota Optimization Protocol

Before executing any task, evaluate its complexity and recommend or confirm the optimal model tier to preserve 5-hour and weekly Pro quota limits:

## 1. Lightweight & Routine Tasks (Low Complexity)
- **Scope:** Minor UI tweaks (CSS/Tailwind adjustments, text/color changes), single-file edits, boilerplate generation, syntax fixes, formatting, and simple documentation updates.
- **Recommended Model:** `Gemini 4 Hydrogen` or `Gemini 3.8 Flash`
- **Execution Rule:** Keep responses concise, read only the target file(s), and execute directly without deep multi-file reasoning.

## 2. Standard Development Tasks (Medium Complexity)
- **Scope:** Building new UI components, connecting API endpoints, writing unit tests, moderate refactoring across 2 to 4 files, and standard feature implementation.
- **Recommended Model:** `Gemini 4 Argon`
- **Execution Rule:** Outline a brief 3-step plan before modifying files. Limit context scanning to relevant directories only.

## 3. Heavy & Architectural Tasks (High Complexity)
- **Scope:** System architecture design, complex multi-file debugging, state management overhauls, root-cause analysis of persistent errors, and performance optimization.
- **Recommended Model:** `Gemini 4 Neon` (Primary) or `Claude Sonnet 5.5` / `Opus 5.5` (Secondary/Fallback for tricky logic)
- **Execution Rule:** Perform thorough analysis before writing code. Warn the user if a heavy model is active when the requested task only requires a lightweight model.

## 4. Quota Guardrails
- Always alert the user at the start of a response if they are currently running a heavy model (`Gemini 4 Neon` or `Claude`) on a trivial task, and suggest switching down to `Gemini 4 Hydrogen` or `Flash`.
- Recommend starting a fresh chat thread whenever switching to an unrelated feature or after completing a major milestone to prevent context bloat.

## 5. Compatibility with Project Rules
- Mandatory rules in `AGENTS.md` (running tests before claiming completion, never pushing directly to `main`, separate PRs for API/database contracts and new dependencies, and no em dash or en dash) always apply across all complexity levels.
- Model switching is performed manually by the project owner via the model selector; the agent advises or warns at the start of a response whenever a mismatch is detected.
