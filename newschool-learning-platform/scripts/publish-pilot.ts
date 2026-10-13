// Publish every course in content/ as a pilot (school owner, 2026-10-13; ADR-040).
//
//   pnpm content:publish-pilot [dir]           edit the files
//   pnpm content:publish-pilot [dir] --check   only report what would change; exit 1 if anything would
//
// course.yaml → `status: published` and `pilot: true`; each cycle file →
// `status: published` (draft or in review; archived stays archived), and
// sections marked `in_review` likewise. `review:` lists stay: teachers keep
// answering them while students use the material. Nothing else in a file
// changes (src/content/publish.ts checks every edit by parsing it).
// Run `pnpm content:validate` afterwards, then `pnpm content:import`.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { publishCourseAsPilot, publishCycle } from '../src/content/publish';

function yamlFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return yamlFiles(path);
      return /\.ya?ml$/.test(name) ? [path] : [];
    });
}

function main() {
  const [dir = 'content'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const check = process.argv.includes('--check');
  let courses = 0;
  let cycles = 0;
  let unchanged = 0;
  for (const path of yamlFiles(dir)) {
    const file = relative(process.cwd(), path);
    const isCourse = /^course\.ya?ml$/.test(basename(path));
    const before = readFileSync(path, 'utf8');
    let result;
    try {
      result = isCourse ? publishCourseAsPilot(before) : publishCycle(before);
    } catch (error) {
      console.error(`✗ ${file}: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    if (!result.changed) {
      unchanged++;
      continue;
    }
    if (isCourse) courses++;
    else cycles++;
    if (check) console.log(`  would publish ${file}`);
    else writeFileSync(path, result.text);
  }
  const verb = check ? 'would publish' : 'published';
  console.log(
    `✓ ${verb} ${courses} course(s) as pilot and ${cycles} cycle file(s); ${unchanged} already up to date`,
  );
  if (check && courses + cycles > 0) process.exit(1);
}

main();
