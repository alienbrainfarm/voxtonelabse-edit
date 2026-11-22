# Security Hardening Implementation Plan

> **For agentic workers:** Use test-driven development and independently review the completed branch.

**Goal:** Reject unsafe MIDI input, constrain Electron permissions, and ship a protected-branch security release.

**Architecture:** Validate incoming MIDI before dispatch; validate effect types before mutation. Constrain Electron to its packaged top-level editor with navigation denial and CSP.

**Tech Stack:** JavaScript, Electron, Node tests, GitHub Actions.

**Spec:** ../specs/2026-11-22-security-hardening-design.md

## Global constraints

No new runtime dependencies. Preserve browser/desktop MIDI and file operations. Release 1.0.1 through a PR; protect main including administrators.

## Review focus

- Valid simulator/hardware dumps and acknowledgements remain accepted.
- Malformed/truncated messages cannot resolve requests or mutate state.
- Effect type rejection is atomic.
- Remote frames, unknown windows, and misleading file URLs cannot obtain MIDI.
- CSP preserves editor initialization, styling, and file downloads.

## Tasks

1. MIDI validation — app/js/sysex.js, midi.js, params.js and dedicated tests. Write failing tests for malformed frames, dump lengths, addresses/indexes, and invalid effect type state preservation; implement bounded validation; run all tests.
2. Electron hardening — electron/main.js, optional security helper, app/index.html, dedicated tests. Write failing permission/navigation tests against production handlers; enforce exact document/window/frame checks, sandbox and CSP; run all tests and smoke-test the real renderer.
3. Release and CI — package.json/package-lock.json version 1.0.1; ensure cross-platform build and dependency checks run on PR and release publication cannot expose partial assets. Run npm test, npm audit, desktop/browser smoke and build checks.
4. Review — independent code review, address actionable findings, verify final diff and tests. Push branch and open PR with concise evidence.
5. Protect and publish — configure main to require PR, CI and resolved conversations, enforce admins, no force push/delete. Merge after checks pass, tag merged commit v1.0.1, monitor release workflow, verify assets and main protection.
