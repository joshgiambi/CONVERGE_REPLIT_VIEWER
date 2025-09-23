#!/usr/bin/env tsx
/**
 * Simple linting script to check for common code quality issues
 */

import { readFile } from 'fs/promises';
import { glob } from 'glob';

interface LintIssue {
  file: string;
  line: number;
  column: number;
  type: 'error' | 'warning';
  message: string;
}

const issues: LintIssue[] = [];

async function checkFile(file: string): Promise<void> {
  try {
    const content = await readFile(file, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      // Check for console.log statements
      if (line.includes('console.log')) {
        issues.push({
          file,
          line: lineNumber,
          column: line.indexOf('console.log') + 1,
          type: 'warning',
          message: 'Use log.debug/info/warn/error instead of console.log',
        });
      }

      // Check for TODO comments
      if (line.includes('TODO') || line.includes('FIXME')) {
        issues.push({
          file,
          line: lineNumber,
          column: line.indexOf('TODO') + 1,
          type: 'warning',
          message: 'TODO or FIXME comment found',
        });
      }

      // Check for long lines (>120 characters)
      if (line.length > 120) {
        issues.push({
          file,
          line: lineNumber,
          column: 121,
          type: 'warning',
          message: 'Line too long (>120 characters)',
        });
      }

      // Check for unused variables (basic check)
      const varMatch = line.match(/\b(const|let|var)\s+(\w+)/);
      if (varMatch && varMatch[2] && !line.includes('=') && !line.includes(varMatch[2])) {
        issues.push({
          file,
          line: lineNumber,
          column: line.indexOf(varMatch[2]) + 1,
          type: 'warning',
          message: 'Potentially unused variable',
        });
      }

      // Check for missing type annotations on function parameters
      const funcMatch = line.match(/\bfunction\s+\w+\s*\(([^)]*)\)/);
      if (funcMatch && funcMatch[1]) {
        const params = funcMatch[1].split(',').map(p => p.trim());
        for (const param of params) {
          if (param && !param.includes(':') && !param.includes('...')) {
            issues.push({
              file,
              line: lineNumber,
              column: line.indexOf(param) + 1,
              type: 'warning',
              message: 'Missing type annotation for function parameter',
            });
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error checking ${file}:`, error);
  }
}

async function runLinting(): Promise<void> {
  console.log('🔍 Running custom linting checks...');

  const files = await glob('client/src/**/*.{ts,tsx}', {
    ignore: ['**/node_modules/**', '**/dist/**'],
  });

  // Check files in parallel
  await Promise.all(files.map(checkFile));

  // Sort issues by file and line
  issues.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  // Display results
  if (issues.length === 0) {
    console.log('✅ No linting issues found!');
    return;
  }

  console.log(`\n⚠️ Found ${issues.length} linting issues:\n`);

  let currentFile = '';
  for (const issue of issues) {
    if (currentFile !== issue.file) {
      console.log(`\n📁 ${issue.file}:`);
      currentFile = issue.file;
    }

    const typeEmoji = issue.type === 'error' ? '❌' : '⚠️';
    console.log(`  ${typeEmoji} Line ${issue.line}:${issue.column} - ${issue.message}`);
  }

  console.log(`\n📊 Summary: ${issues.filter(i => i.type === 'error').length} errors, ${issues.filter(i => i.type === 'warning').length} warnings`);
  console.log('💡 Consider running the cleanup scripts to fix these issues automatically.');
}

runLinting().catch(console.error);