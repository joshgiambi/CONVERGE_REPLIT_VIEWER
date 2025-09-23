#!/usr/bin/env tsx
/**
 * Script to clean up console.log statements and replace them with proper logging
 */

import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';
import { join, dirname } from 'path';

const LOG_PATTERNS = [
  {
    pattern: /console\.debug\(([^)]+)\)/g,
    replacement: 'log.debug($1)',
  },
  {
    pattern: /console\.info\(([^)]+)\)/g,
    replacement: 'log.info($1)',
  },
  {
    pattern: /console\.warn\(([^)]+)\)/g,
    replacement: 'log.warn($1)',
  },
  {
    pattern: /console\.error\(([^)]+)\)/g,
    replacement: 'log.error($1)',
  },
];

async function cleanupConsoleLogs() {
  console.log('🔍 Starting console.log cleanup...');

  const files = await glob('client/src/**/*.{ts,tsx}', {
    ignore: ['**/node_modules/**', '**/dist/**'],
  });

  let totalChanges = 0;

  for (const file of files) {
    try {
      const content = await readFile(file, 'utf8');
      let newContent = content;
      let fileChanges = 0;

      // Check if file already imports log
      const hasLogImport = content.includes("import.*log.*from.*log") ||
                          content.includes("from.*@/lib/log");

      // Apply transformations
      for (const { pattern, replacement } of LOG_PATTERNS) {
        const matches = content.match(pattern);
        if (matches && matches.length > 0) {
          newContent = newContent.replace(pattern, replacement);
          fileChanges += matches.length;
        }
      }

      // Add log import if needed and changes were made
      if (fileChanges > 0 && !hasLogImport) {
        // Find the last import statement
        const importMatches = content.match(/^import.*$/gm);
        if (importMatches && importMatches.length > 0) {
          const lastImportIndex = content.lastIndexOf(importMatches[importMatches.length - 1]);
          const insertPosition = lastImportIndex + importMatches[importMatches.length - 1].length;

          // Insert log import after the last import
          newContent = newContent.slice(0, insertPosition) +
                      '\nimport { log } from \'@/lib/log\';' +
                      newContent.slice(insertPosition);
        }
      }

      if (fileChanges > 0) {
        await writeFile(file, newContent, 'utf8');
        console.log(`✅ ${file}: ${fileChanges} console.log statements replaced`);
        totalChanges += fileChanges;
      }
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error);
    }
  }

  console.log(`\n🎉 Cleanup complete! ${totalChanges} console.log statements replaced.`);
  console.log('📝 Files with changes now use the proper log utility with consistent formatting.');
}

cleanupConsoleLogs().catch(console.error);