// Brand rule (docs/DESIGN-SYSTEM.md §3): colours come only from tokens.
// Fails if a hex/rgb colour appears in src/ outside src/ui/tokens.css, or if a
// physical-direction Tailwind utility (ml-, pr-, left-, text-right…) is used
// instead of a logical one (ms-, pe-, start-, text-end…), which breaks RTL.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const TOKENS = join(SRC, 'ui', 'tokens.css');
const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;
const PHYSICAL =
  /(?<![\w-])(?:-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-[\w./[\]-]+|text-left|text-right|float-left|float-right)(?![\w-])/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx?|css|mjs)$/.test(name)) yield p;
  }
}

const problems = [];
for (const file of walk(SRC)) {
  if (file === TOKENS || file.endsWith('db.types.ts')) continue;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (COLOR.test(line))
        problems.push(`${relative(ROOT, file)}:${i + 1}  raw colour: ${line.trim()}`);
      if (/\.tsx$/.test(file) && PHYSICAL.test(line))
        problems.push(
          `${relative(ROOT, file)}:${i + 1}  physical direction utility: ${line.trim()}`,
        );
    });
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(
    `\n${problems.length} problem(s). Use tokens from src/ui/tokens.css and logical utilities.`,
  );
  process.exit(1);
}
console.log('tokens check: ok');
