#!/usr/bin/env tsx
/**
 * Script to clean up unused imports from TypeScript files
 */

import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';

interface ImportStatement {
  line: number;
  statement: string;
  importedNames: string[];
  moduleName: string;
}

function parseImports(content: string): ImportStatement[] {
  const imports: ImportStatement[] = [];
  const lines = content.split('\n');
  const importRegex = /^(import\s+(?:{([^}]+)}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"])/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(importRegex);

    if (match) {
      const [, fullImport, namedImports, moduleName] = match;
      let importedNames: string[] = [];

      if (namedImports) {
        // Named imports
        importedNames = namedImports
          .split(',')
          .map(name => name.trim().replace(/\s+as\s+\w+/, ''))
          .filter(name => name.length > 0);
      } else {
        // Default or namespace import
        const defaultMatch = fullImport.match(/(?:import\s+)(?:\*\s+as\s+)?(\w+)/);
        if (defaultMatch) {
          importedNames = [defaultMatch[1]];
        }
      }

      imports.push({
        line: i,
        statement: line,
        importedNames,
        moduleName,
      });
    }
  }

  return imports;
}

function findUsedIdentifiers(content: string, excludeImports: Set<string>): Set<string> {
  const used = new Set<string>();

  // Remove import statements for analysis
  let contentWithoutImports = content;
  const importRegex = /^import.*$/gm;
  contentWithoutImports = contentWithoutImports.replace(importRegex, '');

  // Find identifiers (variable names, function names, etc.)
  const identifierRegex = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g;
  let match;

  while ((match = identifierRegex.exec(contentWithoutImports)) !== null) {
    const identifier = match[0];

    // Skip common JavaScript keywords and built-ins
    const skipKeywords = new Set([
      'if', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue',
      'return', 'throw', 'try', 'catch', 'finally', 'function', 'class', 'const',
      'let', 'var', 'async', 'await', 'yield', 'typeof', 'instanceof', 'in',
      'of', 'new', 'this', 'super', 'extends', 'implements', 'interface',
      'type', 'enum', 'declare', 'module', 'namespace', 'export', 'import',
      'from', 'as', 'public', 'private', 'protected', 'static', 'readonly',
      'abstract', 'override', 'true', 'false', 'null', 'undefined', 'string',
      'number', 'boolean', 'object', 'symbol', 'bigint', 'any', 'unknown',
      'never', 'void', 'keyof', 'typeof', 'React', 'JSX', 'Element', 'Node',
      'Document', 'Window', 'HTMLCanvasElement', 'ImageData', 'CanvasRenderingContext2D'
    ]);

    if (!skipKeywords.has(identifier) && !excludeImports.has(identifier)) {
      used.add(identifier);
    }
  }

  return used;
}

async function cleanupUnusedImports() {
  console.log('🔍 Starting unused imports cleanup...');

  const files = await glob('client/src/**/*.{ts,tsx}', {
    ignore: ['**/node_modules/**', '**/dist/**'],
  });

  let totalRemoved = 0;

  for (const file of files) {
    try {
      const content = await readFile(file, 'utf8');
      const imports = parseImports(content);
      const usedIdentifiers = findUsedIdentifiers(content, new Set());

      const usedImports = new Set<string>();
      const unusedImports: ImportStatement[] = [];

      // Check which imports are actually used
      for (const importStmt of imports) {
        const usedNames = importStmt.importedNames.filter(name => usedIdentifiers.has(name));

        if (usedNames.length > 0) {
          usedImports.add(importStmt.moduleName);
        } else {
          unusedImports.push(importStmt);
        }
      }

      if (unusedImports.length === 0) continue;

      // Remove unused import statements
      let newContent = content;
      const lines = content.split('\n');

      for (const unusedImport of unusedImports) {
        lines[unusedImport.line] = '';
        totalRemoved++;
      }

      // Clean up empty lines and extra whitespace
      newContent = lines
        .filter(line => line.trim().length > 0)
        .join('\n');

      // Reconstruct content with proper spacing
      const importSection = lines.slice(0, Math.max(...imports.map(i => i.line)) + 1)
        .filter(line => line.trim().length > 0)
        .join('\n');

      const restOfFile = lines.slice(Math.max(...imports.map(i => i.line)) + 1)
        .filter(line => line.trim().length > 0)
        .join('\n');

      newContent = importSection + '\n\n' + restOfFile;

      await writeFile(file, newContent, 'utf8');
      console.log(`✅ ${file}: Removed ${unusedImports.length} unused imports`);

    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error);
    }
  }

  console.log(`\n🎉 Cleanup complete! ${totalRemoved} unused imports removed.`);
  console.log('📝 Files now have cleaner import statements.');
}

cleanupUnusedImports().catch(console.error);