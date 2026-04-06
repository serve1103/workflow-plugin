# Workflow Plugin

> Automated end-to-end development pipeline for Claude Code — from prompt to commit.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Plugin-blueviolet)](https://code.claude.com)
[![Tests](https://img.shields.io/badge/Tests-100%20passed-brightgreen)]()

---

## Overview

Workflow Plugin automates the repetitive parts of your development cycle. You write code, the plugin handles the rest: **review, confirm, fix, verify, commit**.

```
[You write code/docs]
       ↓
[Review]   Domain-specific reviewers auto-selected by file type
       ↓
[Confirm]  You see the findings and choose what to fix
       ↓
[Fix]      Approved issues auto-fixed (circuit breaker on repeated failures)
       ↓
[Verify]   Lint → Typecheck → Build → Test (deterministic, tool-output only)
       ↓
[Commit]   Change summary report + conventional commit message
```

### Key Features

| Feature | Description |
|---------|-------------|
| **5 Domain Reviewers** | Docs, Frontend, Backend, DA/Data, Security — auto-selected by file path |
| **Human-in-the-Loop** | Review results shown before any auto-fix. You decide: proceed / select / skip / abort |
| **Pipeline Scaling** | 3-line change? Review only. 10+ files? Full pipeline + confirmation gate |
| **Workflow Presets** | feature, bugfix, refactor, docs, security — auto-detected or manual |
| **Rollback** | Git stash checkpoint before pipeline. One command to undo everything |
| **Review Standards** | Built-in industry standards. Override with project-specific rules |
| **Custom Stages** | Add your own pipeline stages (changelog, notify, doc-gen, etc.) |
| **Observability** | Execution logs with timing, token usage, issue counts |

---

## Quick Start

### 1. Install

```bash
# From local directory
claude plugin install .

# Or from GitHub
claude plugin install serve1103/workflow-plugin
```

### 2. Run your first pipeline

```bash
# After making code changes:
/flow post
```

### 3. That's it

The plugin auto-detects your project (language, linter, test runner, etc.) and runs the appropriate pipeline.

---

## Commands

### Core Pipeline

| Command | What it does |
|---------|-------------|
| `/flow` or `/flow post` | Run full post-work pipeline (review → confirm → fix → verify → commit) |
| `/flow enhance "prompt"` | Enhance a vague prompt with codebase context before Claude works |

### Individual Stages

| Command | What it does |
|---------|-------------|
| `/flow review` | Review only — get issues without fixing |
| `/flow fix` | Fix only — requires review.json from prior review |
| `/flow verify` | Verify only — run lint, typecheck, build, test |
| `/flow commit` | Commit only — generate message and commit |

### Utilities

| Command | What it does |
|---------|-------------|
| `/flow rollback` | Restore to the state before the last pipeline run |
| `/flow status` | Show current pipeline state + recent run history |
| `/flow config` | Interactive configuration editor |

---

## How It Works

### Phase 1: Pre-Work (before you code)

**Auto Context Injection** — When enabled, a lightweight hook injects project context (structure, rules, recent changes) into your prompt as a system-reminder. Your prompt stays unchanged; Claude just knows more.

**Prompt Enhancement** — `/flow enhance "fix the login bug"` launches an agent that explores your codebase, then produces a specific, actionable prompt:

```
Before: "fix the login bug"
After:  "Fix JWT token expiry handling in src/auth/login.ts.
         Currently returns 500 when token expires, should return 401.
         The validateToken() function at line 42 catches TokenExpiredError
         but doesn't set the correct status code."
```

### Phase 2: Post-Work (after you code)

#### Step 1 — Analyze
Determines change scale (trivial/small/normal/large), selects preset, picks reviewers.

#### Step 2 — Review
Domain-specific reviewers run in parallel. Each issue gets a severity (CRITICAL/HIGH/MEDIUM/LOW) and a confidence score (0-100). Issues below 80 confidence are filtered out.

**Example output:**
```
## Review Results
- Active reviewers: backend, security
- Issues found: HIGH 2, MEDIUM 1, LOW 3
- Filtered (low confidence): 5

### HIGH Issues
1. [src/auth/login.ts:42] Empty catch block swallows error (confidence: 92)
   Standard: backend.md#error-handling
```

#### Step 3 — Confirm (Human-in-the-Loop)
```
How to proceed?
- proceed: Auto-fix all HIGH/MEDIUM issues
- select:  Choose which issues to fix
- skip:    Skip fixing, go to verify+commit
- abort:   Stop pipeline (rollback available)
```

#### Step 4 — Fix
Auto-fixes approved issues. Max 3 rounds. Circuit breaker stops after 3 identical errors and generates a diagnostic report instead.

#### Step 5 — Verify
Runs lint, typecheck, build, test. All deterministic — pass/fail based on tool exit codes only. If verification fails, attempts fix-verify loop (max 2 retries).

#### Step 6 — Commit
Generates a change summary report and conventional commit message. Optionally pushes or creates a PR.

---

## Reviewers

| Reviewer | Model | Activated When |
|----------|-------|---------------|
| **Docs** | haiku | `docs/**`, `*.md` changes |
| **Frontend** | sonnet | `*.tsx`, `*.vue`, `*.css`, `components/` changes |
| **Backend** | sonnet | `src/api/**`, `routes/**`, `services/**` changes |
| **DA/Data** | sonnet | `migrations/**`, `*.sql`, `prisma/` changes |
| **Security** | sonnet | `auth/**`, `crypto/**` or security preset |

Each reviewer has:
- Domain-specific checklist (built-in, overridable)
- Confidence scoring (0-100, threshold: 80)
- False positive filtering rules
- Failure Modes section (anti-patterns to avoid)

---

## Configuration

Auto-generated on first run at `.claude-workflow/config.json`.

### Key Settings

```json
{
  "pipeline": {
    "pre": { "autoContext": false, "enhance": true },
    "post": ["review", "confirm", "fix", "verify", "commit"],
    "preset": "auto"
  },
  "review": {
    "confidenceThreshold": 80,
    "autoMode": false,
    "maxFixRounds": 3,
    "maxVerifyRetries": 2,
    "circuitBreakerThreshold": 3
  },
  "commit": {
    "style": "conventional",
    "autoPush": false
  },
  "rollback": {
    "strategy": "stash",
    "autoCleanup": true
  }
}
```

### Custom Review Standards

Override built-in standards with project-specific rules:

```
.claude-workflow/standards/
├── docs.md        ← Your documentation standards
├── frontend.md    ← Your frontend conventions
├── backend.md     ← Your API/DB/error handling rules
├── data.md        ← Your schema/migration policies
└── security.md    ← Your security requirements
```

If present, project standards **completely replace** built-in standards (not merge).

### Custom Pipeline Stages

Add stages in `.claude-workflow/stages/`:

```yaml
---
name: changelog
description: Auto-update CHANGELOG with latest changes
model: sonnet
tools: [Glob, Grep, Read, Write, Edit]
onFailure: skip
---

Update CHANGELOG.md based on the committed changes.
```

Then add to your pipeline config:
```json
"post": ["review", "confirm", "fix", "verify", "changelog", "commit"]
```

---

## Safety Mechanisms

| Mechanism | How it works |
|-----------|-------------|
| **Human-in-the-Loop** | Review results require your approval before auto-fix |
| **CRITICAL gate** | Pipeline stops immediately on security/data-loss issues |
| **Circuit Breaker** | Same error 3 times → stops fixing, generates diagnostic report |
| **Rollback** | Git stash checkpoint before every pipeline run |
| **Permission isolation** | Reviewers can't write code. Committer can't edit files |
| **Confidence filter** | Low-confidence issues (< 80) automatically excluded |
| **Pipeline scaling** | Tiny changes get light pipelines, not full 5-stage treatment |
| **Verify-Fix limit** | Max 2 retry loops, then stops and reports |

---

## When to Use / When Not to Use

| Use `/flow post` | Don't use `/flow post` |
|-------------------|----------------------|
| After implementing a feature | For exploratory/prototype code |
| After fixing a bug | When you want to commit a WIP |
| After refactoring | For config-only changes |
| Before creating a PR | When you need full manual control |

---

## Plugin Structure

```
workflow-plugin/
├── agents/          9 specialized subagents
├── skills/flow/     Pipeline orchestration skill
├── hooks/           5 lifecycle event hooks
├── lib/             11 Node.js modules (zero dependencies)
├── standards/       5 built-in review standards
├── templates/       Report and PR templates
└── test/            Integration test suite (100 tests)
```

---

## Troubleshooting

**Plugin not recognized after install**
- Verify `.claude-plugin/plugin.json` exists and has valid JSON
- Restart Claude Code session

**Review finds too many/few issues**
- Adjust `review.confidenceThreshold` (default: 80)
- Add project-specific standards in `.claude-workflow/standards/`

**Pipeline takes too long**
- Check `pipeline.scaling` thresholds
- Use `/flow review` alone for quick checks
- Disable parallel reviewers: `review.parallelReviewers: false`

**Rollback doesn't work**
- Check `git stash list` for workflow-plugin checkpoints
- Ensure you're in a git repository

---

## License

MIT
