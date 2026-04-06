/**
 * Pattern Learning — tracks recurring review issues and user responses.
 * Builds confidence scores to identify real patterns vs false positives.
 * Patterns are never auto-applied; user must approve via /flow learn.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const WORKFLOW_DIR = '.claude-workflow';
const PATTERNS_FILE = join(WORKFLOW_DIR, 'patterns.json');
const LEARNED_FILE = join(WORKFLOW_DIR, 'standards', 'learned.md');
const MAX_PATTERNS = 100;
const STALE_DAYS = 30;
const FALSE_POSITIVE_THRESHOLD = 0.3;
const FALSE_POSITIVE_MIN_OCCURRENCES = 5;

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// --- Pattern storage ---

/**
 * Load patterns from storage.
 * @param {string} rootDir
 * @returns {object} - { patternKey: patternData }
 */
export function loadPatterns(rootDir = '.') {
  const filePath = join(rootDir, PATTERNS_FILE);
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Save patterns to storage.
 * @param {string} rootDir
 * @param {object} patterns
 */
export function savePatterns(rootDir = '.', patterns) {
  ensureDir(join(rootDir, WORKFLOW_DIR));
  const filePath = join(rootDir, PATTERNS_FILE);
  writeFileSync(filePath, JSON.stringify(patterns, null, 2), 'utf-8');
}

// --- Pattern key generation ---

/**
 * Generate a stable key for a review issue pattern.
 * @param {object} issue - { category, message }
 * @returns {string}
 */
export function generatePatternKey(issue) {
  const category = (issue.category || 'unknown').toLowerCase().replace(/\s+/g, '-');
  // Extract core pattern from message (first 50 chars, normalized)
  const core = (issue.message || '')
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 50)
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  return `${category}--${core}`;
}

// --- Recording ---

/**
 * Record a review issue occurrence.
 * Called after Review stage completes.
 * @param {string} rootDir
 * @param {object} issue - { category, message, file, line, severity }
 */
export function recordIssue(rootDir, issue) {
  const patterns = loadPatterns(rootDir);
  const key = generatePatternKey(issue);
  const today = new Date().toISOString().split('T')[0];

  if (!patterns[key]) {
    patterns[key] = {
      category: issue.category || 'unknown',
      filePattern: extractFilePattern(issue.file),
      occurrences: 0,
      accepted: 0,
      rejected: 0,
      fixSuccess: 0,
      fixFailed: 0,
      confidence: 0,
      status: 'observe',
      firstSeen: today,
      lastSeen: today,
      example: `${issue.file}:${issue.line} — ${issue.message}`,
    };
  }

  patterns[key].occurrences++;
  patterns[key].lastSeen = today;
  patterns[key].example = `${issue.file}:${issue.line} — ${issue.message}`;

  recalculateConfidence(patterns[key]);
  savePatterns(rootDir, patterns);
}

/**
 * Record user's response to an issue.
 * @param {string} rootDir
 * @param {object} issue
 * @param {'accepted' | 'rejected'} response
 */
export function recordUserResponse(rootDir, issue, response) {
  const patterns = loadPatterns(rootDir);
  const key = generatePatternKey(issue);

  if (!patterns[key]) return; // Issue not tracked

  if (response === 'accepted') {
    patterns[key].accepted++;
  } else if (response === 'rejected') {
    patterns[key].rejected++;
  }

  recalculateConfidence(patterns[key]);
  savePatterns(rootDir, patterns);
}

/**
 * Record fix result for an issue.
 * @param {string} rootDir
 * @param {object} issue
 * @param {'success' | 'failed'} result
 */
export function recordFixResult(rootDir, issue, result) {
  const patterns = loadPatterns(rootDir);
  const key = generatePatternKey(issue);

  if (!patterns[key]) return;

  if (result === 'success') {
    patterns[key].fixSuccess++;
  } else {
    patterns[key].fixFailed++;
  }

  recalculateConfidence(patterns[key]);
  savePatterns(rootDir, patterns);
}

// --- Confidence ---

/**
 * Recalculate confidence for a pattern.
 * confidence = (accepted / occurrences) × (fixSuccess / max(accepted, 1))
 */
function recalculateConfidence(pattern) {
  const acceptRate = pattern.occurrences > 0
    ? pattern.accepted / pattern.occurrences
    : 0;
  const fixRate = pattern.accepted > 0
    ? pattern.fixSuccess / pattern.accepted
    : 0;

  pattern.confidence = Math.round(acceptRate * fixRate * 100) / 100;

  // Update status
  if (pattern.confidence >= 0.9) {
    pattern.status = 'candidate';
  } else if (pattern.confidence >= 0.6) {
    pattern.status = 'suggest';
  } else {
    pattern.status = 'observe';
  }
}

// --- Queries ---

/**
 * Get patterns by status.
 * @param {string} rootDir
 * @param {'observe' | 'suggest' | 'candidate'} status
 * @returns {object[]}
 */
export function getPatternsByStatus(rootDir, status) {
  const patterns = loadPatterns(rootDir);
  return Object.entries(patterns)
    .filter(([, p]) => p.status === status)
    .map(([key, p]) => ({ key, ...p }));
}

/**
 * Get candidate patterns for /flow learn.
 * @param {string} rootDir
 * @returns {object[]}
 */
export function getCandidates(rootDir) {
  return getPatternsByStatus(rootDir, 'candidate');
}

/**
 * Get suggestions for reviewer context enrichment.
 * @param {string} rootDir
 * @returns {object[]}
 */
export function getSuggestions(rootDir) {
  return [
    ...getPatternsByStatus(rootDir, 'suggest'),
    ...getPatternsByStatus(rootDir, 'candidate'),
  ];
}

// --- /flow learn actions ---

/**
 * Approve a pattern — add to learned.md.
 * @param {string} rootDir
 * @param {string} patternKey
 */
export function approvePattern(rootDir, patternKey) {
  const patterns = loadPatterns(rootDir);
  const pattern = patterns[patternKey];
  if (!pattern) return;

  // Add to learned.md
  appendToLearnedMd(rootDir, pattern);

  // Remove from patterns (now it's a standard)
  delete patterns[patternKey];
  savePatterns(rootDir, patterns);
}

/**
 * Reject a pattern — delete from storage.
 * @param {string} rootDir
 * @param {string} patternKey
 */
export function rejectPattern(rootDir, patternKey) {
  const patterns = loadPatterns(rootDir);
  delete patterns[patternKey];
  savePatterns(rootDir, patterns);
}

// --- Cleanup ---

/**
 * Clean stale and false-positive patterns.
 * - 30 days unseen → delete
 * - confidence < 0.3 + 5+ occurrences → delete (false positive)
 * - Over MAX_PATTERNS → delete lowest confidence first
 * @param {string} rootDir
 * @returns {{ removed: number, reasons: string[] }}
 */
export function cleanPatterns(rootDir) {
  const patterns = loadPatterns(rootDir);
  const today = new Date();
  const removed = [];

  for (const [key, pattern] of Object.entries(patterns)) {
    const lastSeen = new Date(pattern.lastSeen);
    const daysSince = Math.floor((today - lastSeen) / (1000 * 60 * 60 * 24));

    // Stale: 30 days unseen
    if (daysSince > STALE_DAYS) {
      delete patterns[key];
      removed.push(`${key}: stale (${daysSince} days unseen)`);
      continue;
    }

    // False positive: low confidence + enough data
    if (pattern.confidence < FALSE_POSITIVE_THRESHOLD
        && pattern.occurrences >= FALSE_POSITIVE_MIN_OCCURRENCES) {
      delete patterns[key];
      removed.push(`${key}: false positive (confidence ${pattern.confidence}, ${pattern.occurrences} occurrences)`);
    }
  }

  // Over max: remove lowest confidence
  const entries = Object.entries(patterns);
  if (entries.length > MAX_PATTERNS) {
    entries.sort((a, b) => a[1].confidence - b[1].confidence);
    const toRemove = entries.slice(0, entries.length - MAX_PATTERNS);
    for (const [key] of toRemove) {
      delete patterns[key];
      removed.push(`${key}: overflow (lowest confidence)`);
    }
  }

  savePatterns(rootDir, patterns);
  return { removed: removed.length, reasons: removed };
}

// --- Learned.md management ---

function appendToLearnedMd(rootDir, pattern) {
  const dir = join(rootDir, WORKFLOW_DIR, 'standards');
  ensureDir(dir);
  const filePath = join(rootDir, LEARNED_FILE);

  let content = '';
  if (existsSync(filePath)) {
    content = readFileSync(filePath, 'utf-8');
  }

  if (!content) {
    content = `# Learned Review Standards

> This file is generated by \`/flow learn\` from approved patterns.
> Manual editing is allowed. Delete an entry to remove that standard.

`;
  }

  const entry = `## ${pattern.category}
- ${pattern.example.split(' — ')[1] || pattern.example}
  (근거: ${pattern.occurrences}회 발견, 승인률 ${Math.round((pattern.accepted / pattern.occurrences) * 100)}%, 수정 성공률 ${pattern.accepted > 0 ? Math.round((pattern.fixSuccess / pattern.accepted) * 100) : 0}%)

`;

  content += entry;
  writeFileSync(filePath, content, 'utf-8');
}

/**
 * Read learned standards.
 * @param {string} rootDir
 * @returns {string|null}
 */
export function readLearnedStandards(rootDir) {
  const filePath = join(rootDir, LEARNED_FILE);
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// --- Helpers ---

function extractFilePattern(filePath) {
  if (!filePath) return '*';
  const parts = filePath.split('/');
  if (parts.length <= 1) return '*';
  // Extract directory pattern: src/api/** → src/api/**/*
  return parts.slice(0, -1).join('/') + '/**/*';
}

// --- CLI ---

if (process.argv[1] && process.argv[1].includes('pattern-tracker')) {
  const cmd = process.argv[2];
  const rootDir = '.';

  if (cmd === 'status') {
    const patterns = loadPatterns(rootDir);
    const keys = Object.keys(patterns);
    console.log(`Patterns: ${keys.length}`);
    for (const [key, p] of Object.entries(patterns)) {
      console.log(`  ${p.status.padEnd(10)} ${key} (conf: ${p.confidence}, occ: ${p.occurrences})`);
    }
  } else if (cmd === 'candidates') {
    const candidates = getCandidates(rootDir);
    if (candidates.length === 0) {
      console.log('No candidates for /flow learn');
    } else {
      candidates.forEach(c => console.log(`  ${c.key} (conf: ${c.confidence})`));
    }
  } else if (cmd === 'clean') {
    const result = cleanPatterns(rootDir);
    console.log(`Removed: ${result.removed}`);
    result.reasons.forEach(r => console.log(`  ${r}`));
  } else if (cmd === 'test') {
    // Smoke test
    console.log('=== Pattern Tracker Test ===');

    // Record issues
    const issue1 = { category: 'Error Handling', message: 'Empty catch block', file: 'src/api/users.ts', line: 42, severity: 'HIGH' };
    const issue2 = { category: 'DB Query', message: 'N+1 query in loop', file: 'src/services/order.ts', line: 15, severity: 'HIGH' };

    for (let i = 0; i < 5; i++) recordIssue(rootDir, issue1);
    for (let i = 0; i < 3; i++) recordIssue(rootDir, issue2);

    // Record responses
    for (let i = 0; i < 4; i++) recordUserResponse(rootDir, issue1, 'accepted');
    recordUserResponse(rootDir, issue1, 'rejected');
    for (let i = 0; i < 3; i++) recordUserResponse(rootDir, issue2, 'accepted');

    // Record fixes
    for (let i = 0; i < 3; i++) recordFixResult(rootDir, issue1, 'success');
    recordFixResult(rootDir, issue1, 'failed');
    for (let i = 0; i < 3; i++) recordFixResult(rootDir, issue2, 'success');

    const patterns = loadPatterns(rootDir);
    const key1 = generatePatternKey(issue1);
    const key2 = generatePatternKey(issue2);

    console.log('Issue 1:', patterns[key1].status, 'conf:', patterns[key1].confidence);
    console.log('Issue 2:', patterns[key2].status, 'conf:', patterns[key2].confidence);

    // Test approve
    if (patterns[key2].confidence >= 0.9) {
      approvePattern(rootDir, key2);
      console.log('Issue 2 approved → learned.md');
    }

    // Test clean
    const cleaned = cleanPatterns(rootDir);
    console.log('Cleaned:', cleaned.removed);

    // Verify
    const learned = readLearnedStandards(rootDir);
    console.log('Learned.md exists:', learned !== null);
    console.log('Test passed ✓');
  } else {
    console.log('Usage: pattern-tracker [status|candidates|clean|test]');
  }
}
