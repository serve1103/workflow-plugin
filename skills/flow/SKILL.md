---
name: flow
description: Automated workflow pipeline — review, fix, verify, commit
argument-hint: "[post|enhance|review|fix|verify|commit|rollback|status|config]"
---

# /flow — Workflow Pipeline

You are the **pipeline orchestrator**. You coordinate agents, manage state, and interact with the user at confirmation points.

## Subcommand Routing

Parse `$ARGUMENTS` to determine which subcommand to run:

| Input | Action |
|-------|--------|
| (empty) or `post` | Run full Phase 2 pipeline |
| `enhance <prompt>` | Run Phase 1B — call enhancer agent with the given prompt |
| `review` | Run Review stage only |
| `fix` | Run Fix stage only |
| `verify` | Run Verify stage only |
| `commit` | Run Commit stage only |
| `rollback` | Restore to last checkpoint |
| `status` | Show pipeline status + recent history |
| `config` | Interactive config editing |
| `learn` | Review and approve/reject learned patterns as review standards |

## Phase 2: Post-Work Pipeline (`/flow` or `/flow post`)

Execute these steps in order:

### Step 1: Analyze & Prepare

1. Run `node ${CLAUDE_PLUGIN_ROOT}/lib/orchestrator.mjs` via Bash to get pipeline decisions
2. The output JSON contains: `changes`, `scale`, `preset`, `stages`, `reviewers`, `requiresConfirmation`
3. If `changes.fileCount === 0`, inform the user "No changes detected" and stop
4. If scale is `trivial`, run only review stage and show summary — skip fix/verify/commit
5. Create rollback checkpoint: `git stash push -m "workflow-plugin-checkpoint"`

### Step 2: Review

For each reviewer in the `reviewers` list, launch a subagent:

- Reviewer agent names: `reviewer-docs`, `reviewer-frontend`, `reviewer-backend`, `reviewer-data`, `reviewer-security`
- If multiple reviewers, launch them in **parallel** using the Agent tool
- Pass each reviewer: the output of `git diff --cached` (or `git diff` if nothing staged), and the list of changed files
- After all reviewers complete, collect their responses

Then process the results:
1. Parse each reviewer's JSON response (issues array)
2. Run `node ${CLAUDE_PLUGIN_ROOT}/lib/orchestrator.mjs` is not needed here — instead, manually deduplicate: same file+line → keep higher severity
3. Filter issues with confidence < 80 (from config `review.confidenceThreshold`)
4. Write results to `.claude-workflow/state/review.json` using this schema:
```json
{
  "issues": [...],
  "summary": { "critical": N, "high": N, "medium": N, "low": N },
  "activeReviewers": ["backend-reviewer", ...],
  "filteredCount": N
}
```
5. Write `.claude-workflow/handoffs/review.md` with review decisions and rationale

### Step 3: CRITICAL Check

If any issue has severity `CRITICAL`:
- **Immediately stop** the pipeline
- Show the CRITICAL issues to the user with full details
- Inform: "CRITICAL issues found. Pipeline stopped. Please review and fix manually, then run `/flow post` again."
- Do NOT proceed to confirm/fix/verify/commit

### Step 4: Confirm (Human-in-the-Loop)

If the `stages` list includes `confirm` and there are HIGH/MEDIUM issues:

Present to the user:
```
## Review Results
- Active reviewers: {list}
- Issues found: HIGH {n}, MEDIUM {n}, LOW {n}
- Filtered (low confidence): {n}

### HIGH Issues
1. [{file}:{line}] {message} (confidence: {n})
   Suggested fix: {suggestedFix}
   Standard: {standardRef}

### MEDIUM Issues
...

How to proceed?
- **proceed**: Auto-fix all HIGH/MEDIUM issues
- **select**: Choose which issues to fix (list numbers)
- **skip**: Skip fixing, go directly to verify+commit
- **abort**: Stop pipeline, rollback available via /flow rollback
```

Wait for the user's response and act accordingly.

If there are **zero** HIGH/MEDIUM issues (only LOW), skip confirm and proceed directly to verify+commit.

### Step 5: Fix

If the user chose `proceed` or `select`:

1. Launch the `fixer` subagent with:
   - The issues to fix (all HIGH/MEDIUM for `proceed`, selected ones for `select`)
   - The handoff from review stage (`.claude-workflow/handoffs/review.md`)
2. After fixer completes, write results to `.claude-workflow/state/fix.json`:
```json
{
  "fixedIssues": [...],
  "remainingIssues": [...],
  "rounds": 1,
  "circuitBreakerTriggered": false
}
```
3. Write `.claude-workflow/handoffs/fix.md` with fix strategy and approach

**Fix-Review Loop** (max `review.maxFixRounds` rounds, default 3):
- If remaining issues > 0, re-run review on the fixed files
- If same error appears 3 times (`review.circuitBreakerThreshold`), stop and generate diagnostic report
- Present diagnostic to user instead of continuing

### Step 6: Verify

1. Launch the `verifier` subagent
2. It will run lint, typecheck, build, test based on project config
3. After completion, write `.claude-workflow/state/verify.json`:
```json
{
  "lint": { "pass": true, "output": "..." },
  "typeCheck": { "pass": true, "output": "..." },
  "build": { "pass": true, "output": "..." },
  "test": { "pass": true, "output": "..." },
  "overallPass": true
}
```

**Verify-Fix Loop** (max `review.maxVerifyRetries` times, default 2):
- If verify fails, launch fixer to fix the failures
- If still failing after max retries, stop pipeline and report to user

### Step 7: Commit + Push + PR

If verify passed (or user chose `skip` at confirm):

1. If scale is `large`, ask user for final confirmation before committing
2. Launch the `committer` subagent with:
   - The full diff
   - verify.json results
   - Project's commit style preference
3. It will generate a summary report and commit message, then commit
4. Write `.claude-workflow/state/commit.json`
5. Clean up rollback checkpoint: `git stash drop` (if `rollback.autoCleanup` is true)

**Push** (if `commit.autoPush` is true):
6. Run `git push` to push the commit to remote

**PR** (if `commit.autoCreatePR` is `"confirm"` or `true`):
7. Generate PR body from: review results + change summary + verification results (use `templates/pr-body.md`)
8. If `autoCreatePR` is `"confirm"`:
   - Present the PR title and body to the user
   - Ask: "이 내용으로 PR 생성할까요?" → **approve** / **edit** / **cancel**
   - Wait for user response
   - If approve: create PR via `gh pr create` (or `glab`/`bitbucket` based on platform)
   - If edit: let user modify, then create
   - If cancel: skip PR (commit and push already done)
9. If `autoCreatePR` is `true`: create PR immediately without asking
10. Present the summary report + PR URL to the user

### Pipeline Complete

Show final summary:
```
## Pipeline Complete
- Preset: {preset} | Scale: {scale}
- Reviewed by: {reviewers}
- Issues: {found} found → {fixed} fixed → {remaining} remaining
- Verification: {pass/fail}
- Commit: {hash} — {message}
- Push: {success/skipped}
- PR: {url/skipped/cancelled}
```

## Phase 1B: Enhance (`/flow enhance <prompt>`)

1. Launch the `enhancer` subagent with the user's prompt
2. The enhancer will explore the codebase and generate a structured prompt
3. Present the enhanced prompt to the user
4. Based on `enhance.mode`:
   - `confirm`: Ask user to approve/edit before proceeding
   - `auto`: Proceed immediately
   - `suggest`: Show suggestion only, user decides

## `/flow review`, `/flow fix`, `/flow verify`, `/flow commit`

Run the individual stage only, following the same logic as above but without the full pipeline context.

## `/flow rollback`

1. Check if a workflow checkpoint exists: `git stash list | grep workflow-plugin-checkpoint`
2. If found: `git stash pop` and inform user
3. If not found: inform "No rollback checkpoint available"

## `/flow status`

1. Read `.claude-workflow/state/current-run.json` for active run
2. Read `.claude-workflow/logs/` for recent history
3. Present current state and last 5 runs

## `/flow config`

Interactive editing of `.claude-workflow/config.json`. Ask the user what they want to change and update accordingly.

## `/flow learn`

Review learned patterns and approve/reject them as review standards.

1. Run `node ${CLAUDE_PLUGIN_ROOT}/lib/pattern-tracker.mjs candidates` to get candidate patterns
2. If no candidates, check suggestions: `node ${CLAUDE_PLUGIN_ROOT}/lib/pattern-tracker.mjs status`
3. Present each candidate to the user:
```
## Learned Pattern Candidates

1. **Error Handling — Empty catch block**
   - Found: 7 times | Accepted: 5 (71%) | Fix success: 4 (80%)
   - Confidence: 0.71
   - Example: src/api/users.ts:42 — catch block ignores error
   → approve / reject / skip
```
4. For each user choice:
   - **approve**: Pattern is added to `.claude-workflow/standards/learned.md`
   - **reject**: Pattern is deleted from storage
   - **skip**: Pattern stays for future review
5. After processing, run cleanup: `node ${CLAUDE_PLUGIN_ROOT}/lib/pattern-tracker.mjs clean`

### Pattern Recording (integrated into pipeline)

After **Review** stage: record each discovered issue via pattern-tracker.
After **Confirm** stage: record user response (accepted for proceed/select, rejected for skip).
After **Fix** stage: record fix results (success if issue resolved, failed if same error persists).

## Important Rules

- **Never skip the confirm step** when issues are found (unless `review.autoMode` is true and no CRITICAL)
- **Always create a rollback checkpoint** before making changes
- **Write state files after each stage** so resume works if interrupted
- **Agent responses may not be perfect JSON** — if parsing fails, ask the agent to reformat
- Each agent runs as a **subagent** (isolated context) — pass all needed information explicitly
