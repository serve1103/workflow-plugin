/**
 * Pipeline execution logger.
 * Records timing, token usage, issues, and outcomes for each run.
 * Supports /flow status queries.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

const LOGS_DIR = join('.claude-workflow', 'logs');

function ensureDir() {
  if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Start a new pipeline run log.
 * @param {string} runId
 * @param {object} meta - { preset, scale, reviewers, fileCount }
 * @returns {string} logPath
 */
export function startLog(runId, meta = {}) {
  ensureDir();
  const log = {
    runId,
    startTime: new Date().toISOString(),
    endTime: null,
    status: 'running',
    preset: meta.preset || 'unknown',
    scale: meta.scale || 'unknown',
    reviewers: meta.reviewers || [],
    fileCount: meta.fileCount || 0,
    stages: [],
    totals: {
      issuesFound: 0,
      issuesFixed: 0,
      issuesRemaining: 0,
    },
    userChoices: [],
  };

  const logPath = join(LOGS_DIR, `${runId}-run.json`);
  writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
  return logPath;
}

/**
 * Log a stage execution.
 * @param {string} runId
 * @param {object} stage - { name, startTime, endTime, result, model, details }
 */
export function logStage(runId, stage) {
  const log = readLog(runId);
  if (!log) return;

  log.stages.push({
    name: stage.name,
    startTime: stage.startTime || new Date().toISOString(),
    endTime: stage.endTime || new Date().toISOString(),
    durationMs: stage.durationMs || 0,
    result: stage.result || 'unknown', // pass | fail | skip | abort
    model: stage.model || null,
    details: stage.details || null,
  });

  writeLog(runId, log);
}

/**
 * Log a user choice at a confirmation point.
 * @param {string} runId
 * @param {object} choice - { point, decision, timestamp }
 */
export function logUserChoice(runId, choice) {
  const log = readLog(runId);
  if (!log) return;

  log.userChoices.push({
    point: choice.point,
    decision: choice.decision,
    timestamp: choice.timestamp || new Date().toISOString(),
  });

  writeLog(runId, log);
}

/**
 * Update issue totals.
 * @param {string} runId
 * @param {object} totals - { issuesFound, issuesFixed, issuesRemaining }
 */
export function logTotals(runId, totals) {
  const log = readLog(runId);
  if (!log) return;

  log.totals = { ...log.totals, ...totals };
  writeLog(runId, log);
}

/**
 * Finish the run log.
 * @param {string} runId
 * @param {'completed' | 'failed' | 'aborted'} status
 */
export function finishLog(runId, status) {
  const log = readLog(runId);
  if (!log) return;

  log.endTime = new Date().toISOString();
  log.status = status;

  // Calculate total duration
  if (log.startTime) {
    log.totalDurationMs = new Date(log.endTime) - new Date(log.startTime);
  }

  writeLog(runId, log);
}

/**
 * Get recent run history for /flow status.
 * @param {number} count - Number of recent runs to return
 * @returns {object[]}
 */
export function getRecentRuns(count = 5) {
  ensureDir();

  try {
    const files = readdirSync(LOGS_DIR)
      .filter(f => f.endsWith('-run.json'))
      .sort()
      .reverse()
      .slice(0, count);

    return files.map(f => {
      try {
        const log = JSON.parse(readFileSync(join(LOGS_DIR, f), 'utf-8'));
        return {
          runId: log.runId,
          startTime: log.startTime,
          status: log.status,
          preset: log.preset,
          scale: log.scale,
          totalDurationMs: log.totalDurationMs,
          issuesFound: log.totals?.issuesFound || 0,
          issuesFixed: log.totals?.issuesFixed || 0,
          stageCount: log.stages?.length || 0,
        };
      } catch {
        return { file: f, error: 'parse failed' };
      }
    });
  } catch {
    return [];
  }
}

/**
 * Get the current active run (if any).
 * @returns {object|null}
 */
export function getActiveRun() {
  const runs = getRecentRuns(1);
  if (runs.length > 0 && runs[0].status === 'running') {
    return readLog(runs[0].runId);
  }
  return null;
}

// --- Internal helpers ---

function readLog(runId) {
  const logPath = join(LOGS_DIR, `${runId}-run.json`);
  if (!existsSync(logPath)) return null;
  try {
    return JSON.parse(readFileSync(logPath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeLog(runId, log) {
  ensureDir();
  const logPath = join(LOGS_DIR, `${runId}-run.json`);
  writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
}

// CLI entry point
if (process.argv[1] && process.argv[1].includes('logger')) {
  const cmd = process.argv[2];

  if (cmd === 'recent') {
    console.log(JSON.stringify(getRecentRuns(), null, 2));
  } else if (cmd === 'active') {
    console.log(JSON.stringify(getActiveRun(), null, 2));
  } else if (cmd === 'test') {
    // Quick smoke test
    const id = 'test-' + Date.now();
    startLog(id, { preset: 'feature', scale: 'normal', reviewers: ['backend'], fileCount: 3 });
    logStage(id, { name: 'review', result: 'pass', durationMs: 1200 });
    logUserChoice(id, { point: 'confirm', decision: 'proceed' });
    logTotals(id, { issuesFound: 2, issuesFixed: 2, issuesRemaining: 0 });
    finishLog(id, 'completed');
    const log = readLog(id);
    console.log('Stages:', log.stages.length);
    console.log('Status:', log.status);
    console.log('Issues:', log.totals);
    console.log('Choices:', log.userChoices.length);
    console.log('Test passed ✓');
  } else {
    console.log('Usage: logger [recent|active|test]');
  }
}
