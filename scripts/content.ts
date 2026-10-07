// Content tooling (docs/CONTENT-MODEL.md §6).
//
//   pnpm content:validate [dir]   check every content/**/*.yaml file; exit 1 on problems
//   pnpm content:import  [dir]    validate, then upsert into the database by slug
//                                 (sections edited in the platform are skipped unless
//                                 --overwrite-app-edits is passed)
//
// Import runs against the local database by default. A staging import needs
// APP_ENV=staging and --confirm=<host of NEXT_PUBLIC_SUPABASE_URL>. It always
// refuses production: content reaches production through review in the CMS.
// The secret key is read from the environment (.env.local locally), never
// from this repository.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseDocument } from 'yaml';
import {
  activityPlaceholder,
  compileItem,
  type AuthoredActivity,
} from '../src/content/activities-file';
import { validateContent, type CourseFile, type CycleFile } from '../src/content/files';
import type { Block } from '../src/content/schema';
import type { Database, Json } from '../src/server/db.types';

type Client = SupabaseClient<Database>;

function yamlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return yamlFiles(path);
    return /\.ya?ml$/.test(name) ? [path] : [];
  });
}

function load(dir: string) {
  const problems: { file: string; path: string; message: string }[] = [];
  const files = yamlFiles(dir)
    .sort()
    .flatMap((path) => {
      const file = relative(process.cwd(), path);
      const doc = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true });
      if (doc.errors.length) {
        problems.push(...doc.errors.map((e) => ({ file, path: '', message: e.message })));
        return [];
      }
      return [{ file, data: doc.toJS() as unknown }];
    });
  const result = validateContent(files);
  return { ...result, problems: [...problems, ...result.problems], count: files.length };
}

function report(problems: { file: string; path: string; message: string }[]) {
  for (const p of problems)
    console.error(`✗ ${p.file}${p.path ? ` › ${p.path}` : ''}: ${p.message}`);
}

async function must<T>(
  label: string,
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<NonNullable<T>> {
  const { data, error } = await query;
  if (error || data === null || data === undefined)
    throw new Error(`${label}: ${error?.message ?? 'no data'}`);
  return data;
}

async function importCourse(db: Client, c: CourseFile): Promise<string> {
  const language = await must(
    `language ${c.language.code}`,
    db
      .from('languages')
      .upsert(
        { code: c.language.code, name: c.language.name, direction: c.language.direction },
        { onConflict: 'code' },
      )
      .select('id')
      .single(),
  );
  const level = await must(
    `level ${c.level.code}`,
    db
      .from('levels')
      .upsert(
        {
          language_id: language.id,
          code: c.level.code,
          title: c.level.title,
          position: c.level.position,
          cefr: c.level.cefr ?? null,
        },
        { onConflict: 'language_id,code' },
      )
      .select('id')
      .single(),
  );
  const course = await must(
    `course ${c.slug}`,
    db
      .from('courses')
      .upsert(
        {
          slug: c.slug,
          level_id: level.id,
          title: c.title,
          description: c.description,
          instruction_locale: c.instructionLocale,
          status: c.status,
        },
        { onConflict: 'slug' },
      )
      .select('id')
      .single(),
  );
  for (const [kind, title] of Object.entries(c.books)) {
    if (!title) continue;
    await must(
      `book ${kind}`,
      db
        .from('books')
        .upsert(
          { course_id: course.id, kind: kind as 'notebook' | 'workbook', title },
          { onConflict: 'course_id,kind' },
        )
        .select('id')
        .single(),
    );
  }
  return course.id;
}

async function importActivity(
  db: Client,
  courseId: string,
  cycleId: string,
  status: CycleFile['status'],
  a: AuthoredActivity,
): Promise<string> {
  const activity = await must(
    `activity ${a.slug}`,
    db
      .from('activities')
      .upsert(
        {
          course_id: courseId,
          cycle_id: cycleId,
          slug: a.slug,
          title: a.title,
          phase: a.phase,
          scoring_mode: a.scoring,
          est_minutes: a.minutes ?? null,
          instructions: a.instructions,
          status,
        },
        { onConflict: 'course_id,slug' },
      )
      .select('id')
      .single(),
  );

  for (const [position, authored] of a.items.entries()) {
    const item = compileItem(a.slug, authored);
    const row = await must(
      `item ${a.slug}/${item.slug}`,
      db
        .from('activity_items')
        .upsert(
          {
            activity_id: activity.id,
            course_id: courseId,
            slug: item.slug,
            position: position + 1,
            type: item.type,
            prompt: item.prompt,
            data: item.data as NonNullable<Json>,
            points: item.points,
          },
          { onConflict: 'activity_id,slug' },
        )
        .select('id')
        .single(),
    );
    // The key lives in its own table, which students cannot read (ADR-006).
    if (item.key) {
      await must(
        `key ${a.slug}/${item.slug}`,
        db
          .from('activity_item_keys')
          .upsert(
            {
              item_id: row.id,
              course_id: courseId,
              answer: item.key as NonNullable<Json>,
              feedback: item.feedback,
            },
            { onConflict: 'item_id' },
          )
          .select('item_id')
          .single(),
      );
    } else {
      await db.from('activity_item_keys').delete().eq('item_id', row.id);
    }
  }

  // Items removed from the file: delete them unless students already answered them.
  const keep = new Set(a.items.map((i) => i.id));
  const existing = await must(
    'items',
    db.from('activity_items').select('id, slug').eq('activity_id', activity.id),
  );
  for (const old of existing.filter((i) => i.slug && !keep.has(i.slug))) {
    const { count } = await db
      .from('responses')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', old.id);
    if (count) {
      console.warn(
        `  ! item "${a.slug}/${old.slug}" was removed from the file but has answers; kept`,
      );
    } else {
      await db.from('activity_items').delete().eq('id', old.id);
    }
  }
  return activity.id;
}

async function importCycle(
  db: Client,
  courseId: string,
  c: CycleFile & { file: string },
): Promise<void> {
  const cycle = await must(
    `cycle ${c.slug}`,
    db
      .from('cycles')
      .upsert(
        {
          course_id: courseId,
          slug: c.slug,
          title: c.title,
          communicative_goal: c.goal,
          position: c.position,
          status: c.status,
        },
        { onConflict: 'course_id,slug' },
      )
      .select('id')
      .single(),
  );
  const books = await must('books', db.from('books').select('id, kind').eq('course_id', courseId));

  // Exercises first, so sections can point at their real ids.
  const realIds = new Map<string, string>();
  for (const a of c.activities) {
    realIds.set(
      activityPlaceholder(a.slug),
      await importActivity(db, courseId, cycle.id, c.status, a),
    );
  }
  const withRealIds = (blocks: Block[]): Block[] =>
    blocks.map((b) =>
      b.type === 'activity' ? { ...b, activityId: realIds.get(b.activityId) ?? b.activityId } : b,
    );

  for (const [position, s] of c.sections.entries()) {
    const book = books.find((b) => b.kind === s.book);
    if (!book)
      throw new Error(`Section ${s.slug}: the course has no ${s.book} book in course.yaml`);
    // Sections edited in the platform's content editor are not overwritten
    // from files unless asked: the file may be older than the edit.
    const { data: existing } = await db
      .from('book_sections')
      .select('edited_in_app_at')
      .eq('book_id', book.id)
      .eq('slug', s.slug)
      .maybeSingle();
    if (existing?.edited_in_app_at && !process.argv.includes('--overwrite-app-edits')) {
      console.warn(
        `! ${c.slug}/${s.slug}: edited in the platform on ${existing.edited_in_app_at}; left as it is (pass --overwrite-app-edits to replace it).`,
      );
      continue;
    }
    const section = await must(
      `section ${s.slug}`,
      db
        .from('book_sections')
        .upsert(
          {
            book_id: book.id,
            course_id: courseId,
            cycle_id: cycle.id,
            slug: s.slug,
            position: position + 1,
            title: s.title,
            blocks: withRealIds(s.blocks),
            phase: s.phase,
            status: s.status ?? c.status,
            // The file is the source again.
            edited_in_app_at: null,
          },
          { onConflict: 'book_id,slug' },
        )
        .select('id')
        .single(),
    );
    await must(
      `teacher notes ${s.slug}`,
      db
        .from('section_teacher_notes')
        .upsert(
          { section_id: section.id, course_id: courseId, blocks: s.teacherNotes },
          { onConflict: 'section_id' },
        )
        .select('section_id')
        .single(),
    );
  }

  for (const v of c.vocabulary) {
    const set = await must(
      `vocabulary ${v.slug}`,
      db
        .from('vocabulary_sets')
        .upsert(
          {
            course_id: courseId,
            cycle_id: cycle.id,
            slug: v.slug,
            title: v.title,
            status: c.status,
          },
          { onConflict: 'course_id,slug' },
        )
        .select('id')
        .single(),
    );
    await must(
      `vocabulary items ${v.slug}`,
      db
        .from('vocabulary_items')
        .upsert(
          v.items.map((item, i) => ({
            set_id: set.id,
            course_id: courseId,
            position: i + 1,
            term: item.term,
            gloss: item.gloss,
            example: item.example,
          })),
          { onConflict: 'set_id,term' },
        )
        .select('id'),
    );
    // Words removed from the file are removed from the set.
    const keep = new Set(v.items.map((i) => i.term));
    const existing = await must(
      'vocabulary items',
      db.from('vocabulary_items').select('id, term').eq('set_id', set.id),
    );
    const stale = existing.filter((i) => !keep.has(i.term)).map((i) => i.id);
    if (stale.length)
      await must('remove words', db.from('vocabulary_items').delete().in('id', stale).select('id'));
  }

  // Sections are never deleted by an import (students' answers hang off them).
  const known = await must(
    'sections',
    db.from('book_sections').select('slug, title').eq('cycle_id', cycle.id),
  );
  const inFile = new Set(c.sections.map((s) => s.slug));
  for (const s of known.filter((k) => k.slug && !inFile.has(k.slug))) {
    console.warn(
      `  ! section "${s.slug}" (${s.title}) is not in ${c.file}; archive it in the CMS if it is gone`,
    );
  }
}

function target(): { url: string; secret: string } {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const secret = process.env.SUPABASE_SECRET_KEY ?? '';
  if (!url || !secret)
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required');

  const appEnv = process.env.APP_ENV ?? 'local';
  if (appEnv === 'production')
    throw new Error('Refusing to import into production. Use the CMS review flow.');
  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url);
  if (!local) {
    const confirm = process.argv
      .find((a) => a.startsWith('--confirm='))
      ?.slice('--confirm='.length);
    if (appEnv !== 'staging' || confirm !== new URL(url).host) {
      throw new Error(
        `Refusing to import into ${url}. For staging set APP_ENV=staging and pass --confirm=${new URL(url).host}.`,
      );
    }
  }
  return { url, secret };
}

async function main() {
  const [command, dirArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const dir = dirArg ?? 'content';
  if (command !== 'validate' && command !== 'import') {
    console.error('Usage: content <validate|import> [dir]');
    process.exit(2);
  }

  const { courses, cycles, problems, count } = load(dir);
  if (problems.length) {
    report(problems);
    console.error(`\n${problems.length} problem(s) in ${dir}/`);
    process.exit(1);
  }
  console.log(`✓ ${count} file(s): ${courses.length} course(s), ${cycles.length} cycle(s)`);
  for (const c of cycles) {
    if (c.review.length) console.log(`  ${c.file}: ${c.review.length} open review question(s)`);
  }
  if (command === 'validate') return;

  const { url, secret } = target();
  const db = createClient<Database>(url, secret, { auth: { persistSession: false } });
  for (const course of courses) {
    const courseId = await importCourse(db, course);
    console.log(`→ course ${course.slug}`);
    for (const cycle of cycles
      .filter((c) => c.course === course.slug)
      .sort((a, b) => a.position - b.position)) {
      await importCycle(db, courseId, cycle);
      console.log(
        `  → cycle ${cycle.slug} (${cycle.sections.length} sections, ${cycle.activities.length} activities, ${cycle.status})`,
      );
    }
  }
  console.log(`✓ imported into ${url}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
