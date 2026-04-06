/**
 * Lightweight glob pattern matcher (no external dependencies).
 * Supports: *, **, ?, {a,b}
 */

/**
 * Match a file path against a glob pattern.
 * @param {string} filePath
 * @param {string} pattern
 * @returns {boolean}
 */
export function minimatch(filePath, pattern) {
  const regex = globToRegex(pattern);
  return regex.test(filePath);
}

function globToRegex(pattern) {
  let regexStr = '';
  let i = 0;

  // Normalize path separators
  pattern = pattern.replace(/\\/g, '/');

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches any number of directories
        if (pattern[i + 2] === '/') {
          regexStr += '(?:.+/)?';
          i += 3;
        } else {
          regexStr += '.*';
          i += 2;
        }
      } else {
        // * matches anything except /
        regexStr += '[^/]*';
        i++;
      }
    } else if (char === '?') {
      regexStr += '[^/]';
      i++;
    } else if (char === '{') {
      // {a,b,c} alternatives
      const end = pattern.indexOf('}', i);
      if (end !== -1) {
        const alternatives = pattern.substring(i + 1, end).split(',');
        regexStr += '(?:' + alternatives.map(escapeRegex).join('|') + ')';
        i = end + 1;
      } else {
        regexStr += escapeRegex(char);
        i++;
      }
    } else if (char === '.') {
      regexStr += '\\.';
      i++;
    } else if (char === '/') {
      regexStr += '/';
      i++;
    } else {
      regexStr += escapeRegex(char);
      i++;
    }
  }

  return new RegExp('^' + regexStr + '$');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
