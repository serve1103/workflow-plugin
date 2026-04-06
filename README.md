# Workflow Plugin

Automated development workflow pipeline for Claude Code.

## What it does

**Phase 1 (Pre-Work):** Enriches your prompts with project context before Claude works.
**Phase 2 (Post-Work):** Automatically reviews, fixes, verifies, and commits your changes.

```
[You write code/docs]
    ↓
[Review]  Domain-specific reviewers (docs/frontend/backend/data/security)
    ↓
[Confirm] You review the findings and decide what to fix
    ↓
[Fix]     Auto-fix approved issues
    ↓
[Verify]  Lint, typecheck, build, test
    ↓
[Commit]  Auto-generated commit message + summary report
```

## Install

```bash
claude plugin install .
```

## Usage

```bash
# Run full post-work pipeline
/flow post

# Run specific stage
/flow review
/flow fix
/flow verify
/flow commit

# Enhance a prompt before working
/flow enhance "fix the login bug"

# Check pipeline status
/flow status

# Rollback last pipeline changes
/flow rollback

# Configure settings
/flow config
```

## Configuration

Auto-detected on first run. Override in `.claude-workflow/config.json`.

## Custom review standards

Add project-specific review standards in `.claude-workflow/standards/`:

```
.claude-workflow/standards/
├── docs.md
├── frontend.md
├── backend.md
├── data.md
└── security.md
```

If present, these override the built-in standards.

## Custom pipeline stages

Add custom stages in `.claude-workflow/stages/`:

```yaml
---
name: changelog
description: Auto-update CHANGELOG
model: sonnet
tools: [Glob, Grep, Read, Write, Edit]
onFailure: skip
---
```

Then add to config: `"post": ["review", "confirm", "fix", "verify", "changelog", "commit"]`

## License

MIT
