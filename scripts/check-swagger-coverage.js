const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '..', 'routes');

function listRouteFiles() {
  return fs
    .readdirSync(routesDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(routesDir, f));
}

function findRoutesMissingSwagger(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const missing = [];

  // Simple heuristic: each app.<method>('...') should have an @swagger block within previous ~60 lines.
  const routeRe = /\bapp\.(get|post|put|delete)\(\s*['"]([^'"]+)['"]/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(routeRe);
    if (!m) continue;
    const method = m[1].toUpperCase();
    const route = m[2];

    const lookbackStart = Math.max(0, i - 60);
    const ctx = lines.slice(lookbackStart, i).join('\n');
    if (!/@swagger/.test(ctx)) {
      missing.push({ line: i + 1, method, route });
    }
  }

  return missing;
}

function findSwaggerBlocksMissingResponses(filePath) {
  const txt = fs.readFileSync(filePath, 'utf8');
  const re = /\/\*\*[\s\S]*?@swagger[\s\S]*?\*\//g;

  const missing = [];
  let m;
  while ((m = re.exec(txt))) {
    const block = m[0];
    if (!/\bresponses\s*:/.test(block)) {
      const startLine = txt.slice(0, m.index).split(/\r?\n/).length;
      missing.push({ startLine });
    }
  }
  return missing;
}

function main() {
  const files = listRouteFiles();
  const missingSwagger = [];
  const missingResponses = [];

  for (const f of files) {
    const ms = findRoutesMissingSwagger(f);
    if (ms.length) missingSwagger.push({ file: path.relative(process.cwd(), f), routes: ms });

    const mr = findSwaggerBlocksMissingResponses(f);
    if (mr.length) missingResponses.push({ file: path.relative(process.cwd(), f), blocks: mr });
  }

  if (!missingSwagger.length && !missingResponses.length) {
    console.log('OK: swagger coverage looks complete (heuristic).');
    return;
  }

  if (missingResponses.length) {
    console.log('\nSwagger blocks missing responses:', missingResponses.length);
    for (const item of missingResponses) {
      console.log(`- ${item.file}: blocks at lines ${item.blocks.map((b) => b.startLine).join(', ')}`);
    }
  }

  if (missingSwagger.length) {
    console.log('\nRoutes missing nearby @swagger docs:', missingSwagger.length);
    for (const item of missingSwagger) {
      console.log(`\n- ${item.file}`);
      for (const r of item.routes) {
        console.log(`  L${r.line}: ${r.method} ${r.route}`);
      }
    }
  }
}

main();

