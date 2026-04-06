/**
 * Rollback checkpoint management.
 * Creates a restore point before pipeline execution,
 * and restores it on failure or user request.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const STATE_DIR = join('.claude-workflow', 'state');
const CHECKPOINT_FILE = join(STATE_DIR, 'checkpoint.json');
const STASH_PREFIX = 'workflow-plugin-checkpoint';

/**
 * Create a rollback checkpoint before pipeline execution.
 * @param {'stash' | 'branch'} strategy - From config.rollback.strategy
 * @returns {{ success: boolean, id: string, strategy: string, error?: string }}
 */
export function createCheckpoint(strategy = 'stash') {
  try {
    // Check for uncommitted changes first
    const status = execSync('git status --porcelain', { encoding: 'utf-8', timeout: 5000 }).trim();
    if (!status) {
      // No changes to checkpoint — still record that we tried
      const meta = { id: null, strategy, timestamp: new Date().toISOString(), hasChanges: false };
      saveCheckpointMeta(meta);
      return { success: true, id: null, strategy, message: 'No uncommitted changes to checkpoint' };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let id;

    if (strategy === 'branch') {
      const branchName = `workflow-backup-${timestamp}`;
      // Commit current state to a backup branch
      execSync(`git stash push -m "${STASH_PREFIX}-temp"`, { encoding: 'utf-8', timeout: 5000 });
      execSync(`git branch ${branchName}`, { encoding: 'utf-8', timeout: 5000 });
      execSync('git stash pop', { encoding: 'utf-8', timeout: 5000 });
      id = branchName;
    } else {
      // Default: stash strategy
      const stashMsg = `${STASH_PREFIX}-${timestamp}`;
      execSync(`git stash push -m "${stashMsg}"`, { encoding: 'utf-8', timeout: 5000 });
      // Immediately re-apply so working tree has changes (stash is just a backup)
      execSync('git stash apply', { encoding: 'utf-8', timeout: 5000 });
      id = stashMsg;
    }

    const meta = { id, strategy, timestamp: new Date().toISOString(), hasChanges: true };
    saveCheckpointMeta(meta);

    return { success: true, id, strategy };
  } catch (err) {
    return { success: false, id: null, strategy, error: err.message };
  }
}

/**
 * Rollback to the last checkpoint.
 * @returns {{ success: boolean, message: string }}
 */
export function rollback() {
  try {
    const meta = loadCheckpointMeta();
    if (!meta) {
      return { success: false, message: 'No rollback checkpoint found' };
    }

    if (!meta.hasChanges) {
      return { success: true, message: 'Checkpoint had no changes — nothing to rollback' };
    }

    if (meta.strategy === 'branch') {
      // Discard current changes and restore from backup branch
      execSync('git checkout -- .', { encoding: 'utf-8', timeout: 5000 });
      execSync(`git checkout ${meta.id} -- .`, { encoding: 'utf-8', timeout: 5000 });
      return { success: true, message: `Restored from branch ${meta.id}` };
    } else {
      // Stash strategy: discard current changes and pop the stash
      execSync('git checkout -- .', { encoding: 'utf-8', timeout: 5000 });
      // Find the stash index
      const stashList = execSync('git stash list', { encoding: 'utf-8', timeout: 5000 });
      const lines = stashList.split('\n');
      const idx = lines.findIndex(l => l.includes(meta.id));

      if (idx === -1) {
        return { success: false, message: `Stash "${meta.id}" not found. It may have been cleaned up.` };
      }

      execSync(`git stash pop stash@{${idx}}`, { encoding: 'utf-8', timeout: 5000 });
      clearCheckpointMeta();
      return { success: true, message: `Restored from stash "${meta.id}"` };
    }
  } catch (err) {
    return { success: false, message: `Rollback failed: ${err.message}` };
  }
}

/**
 * Clean up checkpoint after successful pipeline completion.
 * @param {boolean} autoCleanup - From config.rollback.autoCleanup
 * @returns {{ success: boolean, message: string }}
 */
export function cleanupCheckpoint(autoCleanup = true) {
  if (!autoCleanup) return { success: true, message: 'Auto-cleanup disabled, checkpoint preserved' };

  try {
    const meta = loadCheckpointMeta();
    if (!meta || !meta.hasChanges) {
      clearCheckpointMeta();
      return { success: true, message: 'No checkpoint to clean up' };
    }

    if (meta.strategy === 'branch') {
      execSync(`git branch -D ${meta.id}`, { encoding: 'utf-8', timeout: 5000 });
    } else {
      const stashList = execSync('git stash list', { encoding: 'utf-8', timeout: 5000 });
      const lines = stashList.split('\n');
      const idx = lines.findIndex(l => l.includes(meta.id));
      if (idx !== -1) {
        execSync(`git stash drop stash@{${idx}}`, { encoding: 'utf-8', timeout: 5000 });
      }
    }

    clearCheckpointMeta();
    return { success: true, message: `Checkpoint "${meta.id}" cleaned up` };
  } catch (err) {
    return { success: false, message: `Cleanup failed: ${err.message}` };
  }
}

/**
 * Check if a checkpoint exists.
 * @returns {object|null}
 */
export function getCheckpoint() {
  return loadCheckpointMeta();
}

// --- Internal helpers ---

function saveCheckpointMeta(meta) {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(meta, null, 2), 'utf-8');
}

function loadCheckpointMeta() {
  if (!existsSync(CHECKPOINT_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf-8'));
    return data.id ? data : null;
  } catch {
    return null;
  }
}

function clearCheckpointMeta() {
  if (existsSync(CHECKPOINT_FILE)) {
    writeFileSync(CHECKPOINT_FILE, '{}', 'utf-8');
  }
}

// CLI entry point
if (process.argv[1] && process.argv[1].includes('rollback')) {
  const cmd = process.argv[2];
  const strategy = process.argv[3] || 'stash';

  if (cmd === 'create') {
    console.log(JSON.stringify(createCheckpoint(strategy), null, 2));
  } else if (cmd === 'restore') {
    console.log(JSON.stringify(rollback(), null, 2));
  } else if (cmd === 'cleanup') {
    console.log(JSON.stringify(cleanupCheckpoint(), null, 2));
  } else if (cmd === 'status') {
    console.log(JSON.stringify(getCheckpoint(), null, 2));
  } else {
    console.log('Usage: rollback [create [stash|branch] | restore | cleanup | status]');
  }
}
