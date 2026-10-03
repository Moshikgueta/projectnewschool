# Content model

> Status: **Proposed — awaiting approval.** The block catalogue is finalised after the
> Phase 0 content audit of real notebooks (see §6).

The goal: New School can publish many courses in many languages **without rebuilding
the application**. Content is structured data; the app is a renderer.

## 1. Hierarchy

```
LANGUAGE        Spanish (es, ltr)
└─ LEVEL        Level 1
   └─ COURSE    Español básico 2025   (instruction language: he)
      ├─ NOTEBOOK ─┐
      ├─ WORKBOOK ─┤  books, divided into sections; each section belongs to a cycle
      └─ CYCLES    │
         ├─ Introducing yourself
         │   ├─ notebook sections   (class notebook content)
         │   ├─ workbook sections   (individual practice)
         │   ├─ activities          (interactive; each tagged with a phase)
         │   ├─ vocabulary set
         │   ├─ teacher notes       (teacher-only)
         │   └─ resources           (media assets: audio, images, PDFs)
         ├─ Daily routines
         └─ …
```

Cycles have a _suggested_ order, but nothing in the model assumes chronology: each group
activates the cycles it is working on (`group_cycles`), and everything a student sees is
filtered by "active cycles of my group" plus assignments.

## 2. Pedagogical phase

Every activity (and optionally a section) carries a `phase`:

| Phase          | Meaning            | Example                                    |
| -------------- | ------------------ | ------------------------------------------ |
| `before_class` | Prepare            | 5 new words + a 3-minute matching activity |
| `during_class` | Used live in class | Notebook dialogue + speaking prompt        |
| `after_class`  | Consolidate        | Workbook practice                          |
| `review`       | Spaced return      | Mixed review ~3 days later                 |
| `optional`     | Extra              | Cultural reading                           |

The dashboard's "Before your next class", "Homework" and "Review" lists are queries over
phase × active cycle × assignments × progress, not hand-curated pages.

## 3. Block documents

A notebook or workbook section is a JSON document:

```json
{
  "schemaVersion": 1,
  "blocks": [
    { "id": "b1", "type": "heading", "level": 2, "text": "¿Qué te gusta comer?", "lang": "es" },
    { "id": "b2", "type": "text", "text": "בפרק הזה נלמד לדבר על **אוכל**.", "lang": "he" },
    { "id": "b3", "type": "vocabulary", "setId": "9c1e…" },
    {
      "id": "b4",
      "type": "dialogue",
      "lang": "es",
      "audioId": "a71f…",
      "lines": [
        { "speaker": "Ana", "text": "¿Te gusta el café?" },
        { "speaker": "Luis", "text": "Sí, mucho." }
      ]
    },
    {
      "id": "b5",
      "type": "grammarBox",
      "title": "Gustar",
      "body": [
        {
          "type": "table",
          "rows": [
            ["me", "gusta"],
            ["te", "gusta"]
          ]
        }
      ]
    },
    { "id": "b6", "type": "activity", "activityId": "4d2b…" },
    {
      "id": "b7",
      "type": "speakingPrompt",
      "lang": "es",
      "text": "Describe tu desayuno ideal.",
      "minutes": 3
    }
  ]
}
```

Rules:

- Every block has a stable `id` (progress, comments and analytics point at it).
- `lang` (BCP 47) on any block sets its language **and direction**. When absent, the
  block inherits the course's instruction language.
- Inline text uses a **restricted inline syntax** (bold, italic, highlight, link to
  allow-listed hosts). No HTML — this is an XSS control (see SECURITY.md).
- Media is referenced by asset **id**, never by URL; the server resolves signed URLs.
- Interactive questions are **activities** referenced by id, so notebook questions and
  workbook exercises share one engine, one grading path and one progress record.
- Teacher-only material is stored in `section_teacher_notes`, never inside `blocks`.
- `schemaVersion` lets content be migrated by script when a block changes shape.

### Teacher view and student view (added after the content audit)

New School's notebooks are **live lesson plans** (see [CONTENT-AUDIT.md](CONTENT-AUDIT.md)).
Every notebook section therefore renders in two views of the same material:

- **Student view:** the section's `blocks`: prompts, sentence frames, examples, rules,
  vocabulary, homework.
- **Teacher view:** the same blocks **plus** teacher notes: timings, stages, grouping
  (pairs, breakout rooms), recommended activity pairs, instructions.

Teacher notes stay in `section_teacher_notes` (never sent to students). Each note carries
`anchor: <block id>`, so the teacher view can place it right after the student block it
belongs to without the two ever being stored together.

### Block catalogue (v1 proposal)

| Block                  | React component           | Notes                                                  |
| ---------------------- | ------------------------- | ------------------------------------------------------ |
| `heading`              | `<SectionHeading/>`       | levels 2–4                                             |
| `text`                 | `<RichText/>`             | restricted inline syntax                               |
| `grammarBox`           | `<GrammarBox/>`           | nested text/table/examples                             |
| `examples`             | `<ExampleList/>`          | target sentence + optional gloss + audio               |
| `dialogue`             | `<Dialogue/>`             | speakers, lines, optional audio and translation toggle |
| `vocabulary`           | `<VocabularySet/>`        | references a set; flashcard entry point                |
| `audio`                | `<AudioPlayer/>`          | transcript required                                    |
| `image`                | `<Figure/>`               | alt text required                                      |
| `table`                | `<ContentTable/>`         | header row/col, mobile scroll                          |
| `tip`                  | `<Tip/>`                  |                                                        |
| `culturalNote`         | `<CulturalNote/>`         |                                                        |
| `speakingPrompt`       | `<SpeakingPrompt/>`       | timer optional; recording later                        |
| `reflection`           | `<ReflectionBox/>`        | saved free text, never graded                          |
| `breakoutInstructions` | `<BreakoutInstructions/>` | for live/online class                                  |
| `activity`             | `<ActivityEmbed/>`        | renders the exercise engine inline                     |
| `download`             | `<Resource/>`             | PDF/worksheet via signed URL                           |
| `callout`              | `<Callout/>`              | info/warning variants from functional tokens           |

`teacherTip` exists as a block type **only** inside `section_teacher_notes`.

**Added in v1.1 by the content audit** (details in CONTENT-AUDIT.md §3): `cycleOverview`,
`sentenceFrame`, `discussionQuestions`, `classActivity`, `wordBank`, `ruleSummary`,
`aiTutorPrompt`, `externalLink` (allow-listed hosts only).

Each block = one Zod schema + one component + one entry in the registry. An unknown or
invalid block renders a safe "content unavailable" placeholder in production and fails
the content import in CI.

## 4. Activities and exercise items

```
activity  (title, instructions, phase, scoring_mode, skills[], est_minutes)
└─ items[] (type, prompt blocks, public data)   +  item key (answer, feedback) – server only
```

| Item type                                                                                             | MVP      | Interaction (touch + keyboard + screen reader)        | Auto-graded                     |
| ----------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------- | ------------------------------- |
| `multipleChoice` (single/multi)                                                                       | ✅       | radio/checkbox group                                  | ✅                              |
| `trueFalse`                                                                                           | ✅       | two-option radio                                      | ✅                              |
| `fillBlank`                                                                                           | ✅       | inline inputs (or word bank)                          | ✅ normalised match             |
| `matching`                                                                                            | ✅       | tap left, tap right (drag optional later)             | ✅                              |
| `reorderSentence`                                                                                     | ✅       | tap tokens into the answer line; move up/down buttons | ✅                              |
| `flashcards` (vocabulary)                                                                             | ✅       | flip, then "knew it" / "not yet"                      | self-rated → spaced review      |
| `shortAnswer` / `reflection`                                                                          | ✅       | textarea                                              | ❌ saved (teacher review later) |
| `categorize`, `dragDrop`, `listeningComprehension`, `readingComprehension`, `writeSentence`, `memory` | Phase 4+ | —                                                     | mostly ✅                       |

**Authoring form** (content files, `src/content/activities-file.ts`). Authors write
each item the way a teacher thinks of it, and the import compiles it into public data,
a server-only key and feedback:

```yaml
activities:
  - slug: family-possessives
    title: 'Possessives: my, his, her, their'
    minutes: 8
    items:
      - id: his-father
        type: multipleChoice
        prompt: Sam is a great cook. ___ father is a great cook too.
        options:
          - { text: His, correct: true }
          - { text: Her, feedback: '*Her* is for a woman or a girl.' }
      - { id: word-order, type: trueFalse, prompt: '…', answer: true }
      - { id: her-their, type: fillBlank, prompt: '…', text: 'This is ___ …', blanks: [[Her]] }
      - { id: pronouns, type: matching, prompt: '…', pairs: [[I, my], [he, his]] }
      - { id: brother, type: reorderSentence, prompt: '…', sentence: My brother's name is Tom. }
      - { id: birthday, type: shortAnswer, prompt: When is your birthday? }
```

Workbook sections embed an exercise by slug: `{ id: ex, type: activity, activity:
family-possessives }`. Options, matches and sentence words are shuffled at import and
numbered in display order (ADR-024), so the stored data never gives the answer away.

**Answer normalisation** (`domain/grading/normalize.ts`), configurable per item:
Unicode NFC, trim, collapse spaces, case-fold, ignore ¿¡ and final punctuation, accept
listed alternatives, and an accent policy (`strict` | `lenient`). Lenient accepts the
answer and still says "check the accent", which teaches without punishing. Optional
stripping of Hebrew niqqud / Arabic harakat.

**Feedback** is per item and per option ("Remember: _gustar_ agrees with the thing
liked"). It lives in the key and is returned only after an answer is submitted.

Scores are recorded but shown only where `scoring_mode = scored`. Most practice shows
"correct / try again" without a grade, because the goal is learning.

## 5. Authoring workflow

**Phases 3–7 (before the CMS):** content is authored as files in the repository and
imported:

```
content/
  es/level-1/espanol-basico-2025/
    course.yaml               title, instruction locale, cycles order
    cycles/01-presentarse/
      notebook.yaml           sections → blocks
      workbook.yaml
      activities/*.yaml       items + keys
      vocabulary.yaml
      teacher-notes.yaml
    media/                    NOT committed when large: uploaded via script to Storage
```

`pnpm content:validate` (CI) checks every file against the Zod schemas.
`pnpm content:import --env=staging` upserts by slug (idempotent), uploads media and
reports changes. Production import is a reviewed, manual step.

**Phase 8 (CMS):** pedagogical managers edit the same block documents in a form-based
editor with draft → review → publish states and preview. Because the database model and
schemas are identical, the CMS is a new _editor_, not a new model.

## 6. Migration of existing New School materials <a id="migration"></a>

Principle: **preserve the pedagogy, change the container.** Nothing is discarded or
rewritten automatically; originals stay untouched as the reference until each converted
course is signed off by a teacher.

### 6.1 Inventory (found so far)

| Material                                              | Where                                                                         | Count                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Digital notebooks (Google Docs)                       | Google Drive                                                                  | 18: English ×3, Spanish ×3, Italian ×3, French ×3, German ×3, Arabic ×3 (levels 1–3) |
| Staff dashboard prototype (UI, flows, auth decisions) | `Moshikgueta/projectnewschool`                                                | 1                                                                                    |
| Spanish course site with workbook                     | personal repos (`spanish-with-moshik-complete`, `espanolsindolordecabeza`, …) | several — **not inspected; ownership to confirm**                                    |
| Audio, images, PDFs                                   | unknown                                                                       | to inventory                                                                         |

### 6.2 What happens to each kind of material

| Material                                                                              | Reuse as-is         | Becomes a component       | Moves into the database     | Stays an asset                | Needs refactoring                    |
| ------------------------------------------------------------------------------------- | ------------------- | ------------------------- | --------------------------- | ----------------------------- | ------------------------------------ |
| Notebook text, explanations, dialogues, examples                                      |                     |                           | ✅ as blocks                |                               | light editing for structure          |
| Recurring notebook layouts (grammar boxes, tip boxes, vocab tables)                   |                     | ✅ block types            |                             |                               |                                      |
| Exercises in notebooks/workbooks                                                      |                     | ✅ exercise engine        | ✅ as activity items + keys |                               | answer keys made explicit            |
| Vocabulary lists                                                                      |                     |                           | ✅ vocabulary sets          |                               |                                      |
| Audio recordings, images                                                              | ✅                  |                           | metadata only               | ✅ Storage                    | alt text and transcripts added       |
| Printable worksheets/PDFs                                                             | ✅                  |                           | metadata only               | ✅ Storage (`download` block) |                                      |
| Staff prototype screens                                                               | as UX reference     | teacher-area design input |                             |                               | rebuilt on the design system         |
| Staff prototype auth rules (lockout, hashed tokens, last-admin guard, no enumeration) | as **requirements** |                           |                             |                               | provided by Supabase Auth + policies |

### 6.3 Conversion pipeline (pilot course)

1. **Audit** two or three notebooks (Phase 0): catalogue every recurring pattern and
   confirm or extend the block catalogue.
2. **Export** Google Docs → structured source (Docs API JSON or DOCX → pandoc).
3. **Convert** with a script to draft YAML blocks. Unknown patterns become `text` blocks
   flagged `review: true`.
4. **Edit** with a teacher: split into cycles and sections, mark phases, make answer
   keys explicit, add alt text and transcripts.
5. **Validate and import** to staging; teacher reviews it on real devices (mobile too).
6. **Sign off and freeze** the Google Doc as archived (to avoid two diverging sources).

### 6.4 Content files and tooling (implemented in Phase 3)

Course source lives in `content/<course-slug>/`:

- `course.yaml`: slug, title, language, level, instruction language, status, book titles.
- One file per cycle (`02-family.yaml`): slug, title, goal, position, status, a
  `review` list of open questions for the reviewing teacher, `sections` (each with
  `slug`, `book`, `phase`, `blocks` and `teacherNotes`) and `vocabulary` sets.

Schemas: `src/content/files.ts` (files) and `src/content/schema.ts` (blocks). Unknown
fields are errors, so a typo never disappears silently. Cross-checks: teacher-note
anchors must be block ids of the same section; slugs, cycle positions and vocabulary
terms are unique; every cycle names a defined course; links must be on the allow-list.

- `pnpm content:validate`: run in CI. Invalid content fails the build (a unit test
  also validates `content/`).
- `pnpm content:import`: validates, then upserts by slug (language → level → course →
  books → cycle → sections → teacher notes → vocabulary). Running it twice changes
  nothing. Sections are never deleted (student answers hang off them); a section
  missing from the file is reported. Words removed from a vocabulary set are removed.
  It runs against the local database by default. Staging needs `APP_ENV=staging` and
  `--confirm=<supabase host>`. Production is always refused: content reaches
  production through review in the CMS (Phase 8).

First conversion: **English Foundations 1 · Family** (`content/en-foundations-1/`),
status `in_review`, with 7 open review questions, plus two draft workbook exercises
written from the cycle's skills (the source has none). One question is a factual error in
the source: rule 2 of the possessives summary says the word follows the thing owned,
which is wrong for English.

The pilot measures the hours per cycle of conversion. That number sets the realistic
schedule for the other 17 notebooks, and it's the biggest unknown in the project.

## 7. Multilingual content rules

- A course has one instruction language. A course for Portuguese speakers learning
  Hebrew is a different course from one for Hebrew speakers learning Spanish, even if
  they share media.
- The target language's direction comes from `languages.direction`; per-block `lang`
  overrides it.
- Interface (UI) language is the student's preference and is independent of both.
