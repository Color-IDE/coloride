import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

function resolveModule(src, file, specifier) {
  const target = specifier.startsWith('@/') ? path.join(src, specifier.slice(2))
    : specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : null;
  if (!target) return null;
  return [target, `${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts'), path.join(target, 'index.tsx')]
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? target;
}

export function inspectRenderer(src, publicApi) {
  const problems = [], graph = new Map();
  const normalizedEntry = file => path.relative(path.join(src, 'features'), file)
    .replaceAll(path.sep, '/').replace(/\.tsx?$/, '').replace(/\/index$/, '/index');
  for (const [feature, entries] of Object.entries(publicApi)) {
    for (const entry of entries) {
      const resolved = resolveModule(src, path.join(src, 'features', feature, '_'), `./${entry}`);
      if (!resolved || !fs.existsSync(resolved)) problems.push(`Missing public entry: ${feature}/${entry}`);
    }
  }
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { inspect(file); continue; }
      if (!/\.tsx?$/.test(file)) continue;
      const owner = path.relative(src, file).split(path.sep);
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const edges = new Set(); graph.set(file, edges);
      function dependency(specifier, runtime) {
        const target = resolveModule(src, file, specifier);
        if (!target) return;
        const area = path.relative(src, target).split(path.sep);
        const label = path.relative(src, file);
        if (owner[0] === 'shared' && ['app', 'features'].includes(area[0])) problems.push(`${label}: shared must not depend on ${area[0]}`);
        if (owner[0] === 'features' && area[0] === 'app') problems.push(`${label}: features must not depend on app`);
        if (area[0] === 'features' && (owner[0] !== 'features' || owner[1] !== area[1])) {
          const entry = normalizedEntry(target).split('/').slice(1).join('/');
          if (!(publicApi[area[1]] ?? []).includes(entry)) problems.push(`${label}: private feature import ${specifier}`);
        }
        if (runtime) edges.add(target);
      }
      function visit(node) {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const clause = node.importClause;
          const named = clause?.namedBindings;
          const onlyTypes = clause?.isTypeOnly || (!clause?.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every(item => item.isTypeOnly));
          dependency(node.moduleSpecifier.text, !onlyTypes);
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const onlyTypes = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every(item => item.isTypeOnly));
          dependency(node.moduleSpecifier.text, !onlyTypes);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
          dependency(node.arguments[0].text, true);
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
          dependency(node.argument.literal.text, false);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  inspect(src);
  const visited = new Set(), active = new Set(), stack = [];
  function visit(file) {
    if (active.has(file)) {
      problems.push(`Runtime import cycle: ${[...stack.slice(stack.indexOf(file)), file].map(item => path.relative(src, item)).join(' -> ')}`);
      return;
    }
    if (visited.has(file)) return;
    visited.add(file); active.add(file); stack.push(file);
    for (const next of graph.get(file) ?? []) visit(next);
    stack.pop(); active.delete(file);
  }
  for (const file of graph.keys()) visit(file);
  return problems;
}
