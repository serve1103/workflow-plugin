/**
 * Integration test suite for workflow-plugin.
 * Tests all modules working together without actually calling Claude agents.
 * Run: node test/integration.mjs
 */

import { detectProject } from '../lib/detect-project.mjs';
import { writeState, readState, hasCompleted, writeHandoff, readHandoff, initRun, finishRun, cleanState } from '../lib/state-manager.mjs';
import { validate } from '../lib/schemas.mjs';
import { orchestrate, analyzeChanges, determineScale, detectPreset, selectReviewers, deduplicateIssues, filterByConfidence } from '../lib/orchestrator.mjs';
import { minimatch } from '../lib/minimatch.mjs';
import { loadCustomStages, isCustomStage, findStage } from '../lib/custom-stages.mjs';
import { startLog, logStage, logUserChoice, logTotals, finishLog, getRecentRuns } from '../lib/logger.mjs';
import { createCheckpoint, getCheckpoint, cleanupCheckpoint } from '../lib/rollback.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

// --- 1. Minimatch ---
console.log('\n=== 1. Minimatch ===');
assert(minimatch('docs/guide.md', 'docs/**/*'), 'docs/**/* matches docs/guide.md');
assert(minimatch('README.md', '*.md'), '*.md matches README.md');
assert(minimatch('src/api/users.ts', 'src/api/**/*'), 'src/api/**/* matches nested path');
assert(!minimatch('test.js', '*.md'), '*.md does not match test.js');
assert(minimatch('src/components/Button.tsx', '*.tsx'), '*.tsx matches .tsx files');
assert(minimatch('migrations/001_init.sql', 'migrations/**/*'), 'migrations/**/* matches');
assert(!minimatch('src/utils/helper.ts', 'docs/**/*'), 'docs/**/* does not match src/');

// --- 2. Schemas ---
console.log('\n=== 2. Schema Validation ===');
const validReview = {
  issues: [{ file: 'a.ts', severity: 'HIGH', confidence: 90 }],
  summary: { critical: 0, high: 1, medium: 0, low: 0 },
  activeReviewers: ['backend-reviewer'],
};
assert(validate('review', validReview).valid, 'Valid review passes schema');
assert(!validate('review', { issues: [] }).valid, 'Review missing summary fails');
assert(!validate('review', {}).valid, 'Empty object fails review schema');
assert(validate('verify', { overallPass: true }).valid, 'Minimal verify passes');
assert(!validate('verify', {}).valid, 'Verify missing overallPass fails');
assert(validate('commit', { commitHash: 'abc', message: 'fix' }).valid, 'Valid commit passes');
assert(!validate('unknown', {}).valid, 'Unknown schema fails');

// --- 3. State Manager ---
console.log('\n=== 3. State Manager ===');
cleanState('.');
const runId = initRun('.', { preset: 'feature', scale: 'normal' });
assert(runId !== null, 'initRun returns a runId');

const writeResult = writeState('.', 'review', validReview);
assert(writeResult.success, 'writeState review succeeds');

const readResult = readState('.', 'review');
assert(readResult !== null, 'readState review returns data');
assert(readResult.issues.length === 1, 'readState review has 1 issue');

assert(hasCompleted('.', 'review'), 'hasCompleted review is true');
assert(!hasCompleted('.', 'fix'), 'hasCompleted fix is false');

writeHandoff('.', 'review', '# Review Handoff\n## Decisions\nApproved all');
const handoff = readHandoff('.', 'review');
assert(handoff !== null && handoff.includes('Review Handoff'), 'Handoff read/write works');

finishRun('.', 'completed');
cleanState('.');
assert(!hasCompleted('.', 'review'), 'After clean, review not completed');

// --- 4. Orchestrator ---
console.log('\n=== 4. Orchestrator ===');

// Scale determination
assert(determineScale({ files: ['a.ts'], additions: 2, deletions: 0, hasDeleted: false }) === 'trivial', 'trivial: 2 lines');
assert(determineScale({ files: ['a.ts', 'b.ts'], additions: 20, deletions: 5, hasDeleted: false }) === 'small', 'small: 2 files');
assert(determineScale({ files: Array(5).fill('f.ts'), additions: 50, deletions: 10, hasDeleted: false }) === 'normal', 'normal: 5 files');
assert(determineScale({ files: Array(15).fill('f.ts'), additions: 100, deletions: 50, hasDeleted: true }) === 'large', 'large: 15 files + deletions');

// Preset detection
assert(detectPreset(['docs/guide.md', 'README.md']) === 'docs', 'docs preset detected');
assert(detectPreset(['src/auth/login.ts']) === 'security', 'security preset detected');
assert(detectPreset(['src/api/users.ts']) === 'feature', 'feature preset (default)');

// Reviewer selection
const r1 = selectReviewers(['src/components/Button.tsx', 'src/api/users.ts']);
assert(r1.includes('frontend') && r1.includes('backend'), 'tsx+api → frontend+backend');
const r2 = selectReviewers(['docs/guide.md']);
assert(r2.includes('docs'), 'md → docs reviewer');
const r3 = selectReviewers(['migrations/001.sql']);
assert(r3.includes('data'), 'sql → data reviewer');
const r4 = selectReviewers(['unknown/file.xyz']);
assert(r4.includes('backend'), 'unknown → default backend');

// Deduplication
const dupes = deduplicateIssues([
  { file: 'a.ts', line: 10, severity: 'MEDIUM', message: 'x' },
  { file: 'a.ts', line: 10, severity: 'HIGH', message: 'y' },
  { file: 'b.ts', line: 5, severity: 'LOW', message: 'z' },
]);
assert(dupes.length === 2, 'Dedup: 3 issues → 2');
assert(dupes.find(i => i.file === 'a.ts').severity === 'HIGH', 'Dedup: keeps HIGH over MEDIUM');

// Confidence filtering
const { passed: conf, filtered } = filterByConfidence([
  { confidence: 90 }, { confidence: 70 }, { confidence: 85 }, { confidence: 50 },
], 80);
assert(conf.length === 2, 'Confidence: 2 pass threshold 80');
assert(filtered === 2, 'Confidence: 2 filtered');

// --- 5. Logger ---
console.log('\n=== 5. Logger ===');
const logId = 'integration-test-' + Date.now();
startLog(logId, { preset: 'feature', scale: 'normal', reviewers: ['backend'], fileCount: 3 });
logStage(logId, { name: 'review', result: 'pass', durationMs: 500 });
logStage(logId, { name: 'verify', result: 'pass', durationMs: 300 });
logUserChoice(logId, { point: 'confirm', decision: 'proceed' });
logTotals(logId, { issuesFound: 3, issuesFixed: 2, issuesRemaining: 1 });
finishLog(logId, 'completed');

const recent = getRecentRuns(1);
assert(recent.length > 0, 'getRecentRuns returns at least 1');
assert(recent[0].status === 'completed', 'Recent run status is completed');

// --- 6. Custom Stages ---
console.log('\n=== 6. Custom Stages ===');
assert(isCustomStage('changelog'), 'changelog is custom');
assert(!isCustomStage('review'), 'review is built-in');
assert(!isCustomStage('commit'), 'commit is built-in');

// Test with temp stage file
const testStagesDir = join('.claude-workflow', 'stages');
mkdirSync(testStagesDir, { recursive: true });
writeFileSync(join(testStagesDir, 'test-stage.md'), `---
name: test-notify
description: Test notification stage
model: haiku
tools: [Bash]
onFailure: skip
---

Send a test notification.
`, 'utf-8');

const { stages, errors } = loadCustomStages('.');
const testStage = findStage(stages, 'test-notify');
assert(testStage !== null, 'Custom stage loaded by name');
assert(testStage.model === 'haiku', 'Custom stage model is haiku');
assert(testStage.onFailure === 'skip', 'Custom stage onFailure is skip');

// Cleanup test stage
rmSync(join(testStagesDir, 'test-stage.md'), { force: true });

// --- 7. Agent Files ---
console.log('\n=== 7. Agent Files ===');
const agents = [
  'agents/enhancer.md',
  'agents/reviewer-backend.md',
  'agents/reviewer-frontend.md',
  'agents/reviewer-docs.md',
  'agents/reviewer-data.md',
  'agents/reviewer-security.md',
  'agents/fixer.md',
  'agents/verifier.md',
  'agents/committer.md',
];

for (const agentFile of agents) {
  const exists = existsSync(agentFile);
  assert(exists, `${agentFile} exists`);
  if (exists) {
    const content = readFileSync(agentFile, 'utf-8');
    const hasFm = /^---\r?\n[\s\S]*?\r?\n---/.test(content);
    assert(hasFm, `${agentFile} has valid frontmatter`);
    assert(!content.includes('disallowedTools'), `${agentFile} no disallowedTools`);
    assert(content.includes('Failure Modes'), `${agentFile} has Failure Modes`);
  }
}

// --- 8. Plugin Structure ---
console.log('\n=== 8. Plugin Structure ===');
const requiredFiles = [
  '.claude-plugin/plugin.json',
  'hooks/hooks.json',
  'skills/flow/SKILL.md',
  'standards/backend.md',
  'standards/frontend.md',
  'standards/docs.md',
  'standards/data.md',
  'standards/security.md',
  'templates/summary-report.md',
  'templates/pr-body.md',
  'README.md',
  '.gitignore',
];

for (const file of requiredFiles) {
  assert(existsSync(file), `${file} exists`);
}

// Verify plugin.json
const pluginJson = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf-8'));
assert(pluginJson.name === 'workflow-plugin', 'plugin.json name correct');
assert(Array.isArray(pluginJson.agents), 'plugin.json has agents array');
assert(pluginJson.agents.length === 9, 'plugin.json has 9 agents');

// Verify hooks.json
const hooksJson = JSON.parse(readFileSync('hooks/hooks.json', 'utf-8'));
const hookEvents = Object.keys(hooksJson.hooks);
assert(hookEvents.length === 5, 'hooks.json has 5 events');
assert(hookEvents.includes('UserPromptSubmit'), 'has UserPromptSubmit hook');
assert(hookEvents.includes('Stop'), 'has Stop hook');
assert(hookEvents.includes('PreToolUse'), 'has PreToolUse hook');

// --- Summary ---
console.log(`\n${'='.repeat(50)}`);
console.log(`Integration Tests: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) process.exit(1);
