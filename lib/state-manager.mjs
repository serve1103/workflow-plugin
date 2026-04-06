import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { validate } from './schemas.mjs';

const WORKFLOW_DIR = '.claude-workflow';
const STATE_DIR = join(WORKFLOW_DIR, 'state');
const HANDOFF_DIR = join(WORKFLOW_DIR, 'handoffs');

/**
 * State manager for pipeline inter-agent data transfer.
 * Agents don't write state directly — the orchestrator (SKILL.md)
 * parses agent responses and writes state via this module.
 */

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function resolvePath(rootDir, subdir, filename) {
  const dir = join(rootDir, subdir);
  ensureDir(dir);
  return join(dir, filename);
}

// --- Run management ---

/**
 * Initialize a new pipeline run.
 * @param {string} rootDir
 * @param {object} meta - { preset, scale, activeReviewers }
 * @returns {string} runId
 */
export function initRun(rootDir, meta) {
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const data = {
    id,
    startTime: new Date().toISOString(),
    endTime: null,
    preset: meta.preset || 'feature',
    scale: meta.scale || 'normal',
    stages: {},
    status: 'running',
    activeReviewers: meta.activeReviewers || [],
    userChoices: {},
  };
  writeState(rootDir, `run-${id}`, data);
  // Also write as "current run" pointer
  writeFileSync(resolvePath(rootDir, STATE_DIR, 'current-run.json'), JSON.stringify({ runId: id }, null, 2), 'utf-8');
  return id;
}

/**
 * Finish the current pipeline run.
 */
export function finishRun(rootDir, status) {
  const current = getCurrentRunId(rootDir);
  if (!current) return;
  const data = readState(rootDir, `run-${current}`);
  if (data) {
    data.endTime = new Date().toISOString();
    data.status = status; // completed | failed | aborted
    writeState(rootDir, `run-${current}`, data);
  }
}

export function getCurrentRunId(rootDir) {
  try {
    const pointer = JSON.parse(readFileSync(resolvePath(rootDir, STATE_DIR, 'current-run.json'), 'utf-8'));
    return pointer.runId;
  } catch {
    return null;
  }
}

// --- State read/write ---

/**
 * Write a state file with schema validation.
 * @param {string} rootDir
 * @param {string} stage - review, fix, verify, commit, or run-{id}
 * @param {object} data
 * @returns {{ success: boolean, errors?: string[] }}
 */
export function writeState(rootDir, stage, data) {
  // Validate against schema (strip run- prefix for validation)
  const schemaName = stage.startsWith('run-') ? 'run' : stage;
  const { valid, errors } = validate(schemaName, data);
  if (!valid) {
    return { success: false, errors };
  }

  const filePath = resolvePath(rootDir, STATE_DIR, `${stage}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return { success: true };
}

/**
 * Read a state file.
 * @param {string} rootDir
 * @param {string} stage
 * @returns {object|null}
 */
export function readState(rootDir, stage) {
  const filePath = join(rootDir, STATE_DIR, `${stage}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Check if a stage has completed (output file exists and is valid).
 * Used for Resume — skip completed stages.
 */
export function hasCompleted(rootDir, stage) {
  const data = readState(rootDir, stage);
  if (!data) return false;
  const { valid } = validate(stage, data);
  return valid;
}

// --- Handoff read/write ---

/**
 * Write a handoff document.
 * @param {string} rootDir
 * @param {string} stage - review, fix, verify
 * @param {string} markdown - Handoff content
 */
export function writeHandoff(rootDir, stage, markdown) {
  const filePath = resolvePath(rootDir, HANDOFF_DIR, `${stage}.md`);
  writeFileSync(filePath, markdown, 'utf-8');
}

/**
 * Read a handoff document.
 * @returns {string|null}
 */
export function readHandoff(rootDir, stage) {
  const filePath = join(rootDir, HANDOFF_DIR, `${stage}.md`);
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// --- Cleanup ---

/**
 * Clean state files from a previous run.
 * Preserves run-*.json for history. Removes review/fix/verify/commit.json and handoffs.
 */
export function cleanState(rootDir) {
  const stages = ['review', 'fix', 'verify', 'commit'];
  for (const stage of stages) {
    const statePath = join(rootDir, STATE_DIR, `${stage}.json`);
    const handoffPath = join(rootDir, HANDOFF_DIR, `${stage}.md`);
    if (existsSync(statePath)) {
      try { writeFileSync(statePath, '', 'utf-8'); } catch { /* ignore */ }
    }
    if (existsSync(handoffPath)) {
      try { writeFileSync(handoffPath, '', 'utf-8'); } catch { /* ignore */ }
    }
  }
  // Remove current-run pointer
  const pointerPath = join(rootDir, STATE_DIR, 'current-run.json');
  if (existsSync(pointerPath)) {
    try { writeFileSync(pointerPath, '', 'utf-8'); } catch { /* ignore */ }
  }
}

// CLI entry point for testing
if (process.argv[1] && process.argv[1].includes('state-manager')) {
  const cmd = process.argv[2];
  const rootDir = process.cwd();

  if (cmd === 'init') {
    const id = initRun(rootDir, { preset: 'feature', scale: 'normal' });
    console.log(`Run initialized: ${id}`);
  } else if (cmd === 'read') {
    const stage = process.argv[3];
    console.log(JSON.stringify(readState(rootDir, stage), null, 2));
  } else if (cmd === 'clean') {
    cleanState(rootDir);
    console.log('State cleaned');
  } else {
    console.log('Usage: state-manager [init|read <stage>|clean]');
  }
}
