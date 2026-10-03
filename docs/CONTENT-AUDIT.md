# Content audit: existing digital notebooks

> Phase 0 checklist item: "Content audit of 2–3 notebooks; block catalogue confirmed."
> Date: 2026-10-03. Method and coverage are stated in §1 so nobody over-reads the results.
> **No notebook content is copied into this repository**: the documents' ownership is not
> yet settled (§6). This file describes structure only, with a few short labels quoted to
> identify elements.

## 1. What was audited, and how much

| Notebook (Google Docs)                                   | Size (text export)                | How it was examined                                                                                                                                                                                 |
| -------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cuaderno digital 2026 – Español básico (Spanish L1)      | ~224,000 characters, ~9,900 lines | **Whole document analysed by script** (headings, tables, links, recurring markers). **Read in full by a person:** the introduction and one complete cycle (Familia, ~500 lines, ≈ 5 % of the text). |
| Digital notebook 2026 – English Foundations (English L1) | ~197,000 characters               | Whole document analysed by script (structure, markers, links). Not read in full.                                                                                                                    |
| מחברת דיגיטלית – ערבית רמה 1 (Arabic L1)                 | ~137,000 characters               | Whole document analysed by script; the opening section (~60 lines) read in full.                                                                                                                    |

The other 15 notebooks were not opened. Images are not included in the text export (the
source files are ~14 MB, so they contain images that this audit did not see).

## 2. Main findings

### 2.1 The notebooks are live lesson plans, not self-study books

Each cycle is written for the **teacher to run a class** (on a shared screen, online or in
the room): durations per activity, stages, instructions like "the teacher sends this link
in the chat", which activities to combine, and empty slots to record each student's
answer ("Student answer 1 / 2 / 3"; 228 such slots in the Spanish notebook).

**Consequence for the platform:** one notebook section needs **two views** of the same
material: a _teacher view_ (full lesson plan: timings, stages, combinations, teacher
instructions) and a _student view_ (prompts, sentence frames, examples, rules,
vocabulary, homework). Teacher-only parts must never reach students (same rule as answer
keys), so they stay in the separate teacher-notes table, **anchored to the student block
they belong to** (see CONTENT-MODEL.md §3.2, added by this audit).

### 2.2 Spanish and English share one cycle curriculum

Spanish L1 and English L1 have nearly the same ~20 cycles in nearly the same order:
introduction / small talk, family, friendship, professions, meeting up (dates and
times), routine, my home, essential services, travel, food, fashion and shopping,
TV and films, fun and games, music, goals and projects, discoveries, arts and crafts,
weather, how to relax.

**Consequence:** cycles are a **school-wide curriculum**, realised per language. The data
model should gain a school-wide `topics` catalogue that each course's cycles point to
(proposed as ADR-021). Benefits: cross-language analytics ("which topic is hardest"), a
new language reuses the plan, and teachers see the same structure in every language.

### 2.3 Each cycle follows a stable template (Spanish, English)

| Part of the cycle                                                                                                                                | Seen as                                                                                           | Frequency (Spanish L1) |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------- |
| Date and participants of the class                                                                                                               | header fields                                                                                     | every cycle            |
| General information: the **2 syllabus skills** (e.g. possessives; dates and numbers), which activities practise each, recommended activity pairs | structured text                                                                                   | every cycle            |
| Quizlet link for the cycle's vocabulary                                                                                                          | external link                                                                                     | 20 Quizlet links       |
| Introduction round (5–10 min)                                                                                                                    | prompt + sentence frame + answer slots                                                            | every cycle            |
| Warm-up questions (15–20 min)                                                                                                                    | questions with **sentence frames** ("My mother's name is ____")                                   | every cycle            |
| Activities 1–4 (15–20 min each), each tagged with its grammar focus (DATES, POSSESSIVES, NUMBERS…)                                               | stages (174 "Etapa"), examples, word banks, "model structure", breakout rooms, external resources | 4 per cycle            |
| Class summary (15–20 min): each skill with ~3 rules, examples and tables                                                                         | rules + examples + tables (735 table lines)                                                       | every cycle            |
| Homework "with Mori" + 2 extra interactive activities                                                                                            | prompts the student copies into a chat with an AI tutor                                           | 13 + extras            |
| Vocabulary table, target language ⇄ Hebrew                                                                                                       | 2-column table                                                                                    | most cycles            |

### 2.4 Arabic is different in two ways

1. **Script:** spoken Arabic is taught in **Hebrew transliteration with niqqud**
   (e.g. "שיחת חולין בערבית מדוברת (תעתיק עברי)"), not in Arabic script. The content
   language is Arabic but the script is Hebrew. Tag it `ar-Hebr` (BCP 47 language + script);
   it is right-to-left, needs fonts with full niqqud support, and answer checking must be
   able to ignore niqqud.
2. **Format:** a different lesson-plan layout (goals with ✔ lists, "מערך שיעור") and no
   common stage/activity markers. The Arabic notebooks need their own conversion mapping.

### 2.5 External services the notebooks depend on

| Service                             | Use                                                 | Platform plan                                                                                                                     |
| ----------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Mori** (AI chat tutor)            | homework conversations driven by copy-paste prompts | ❓ Not linked from the notebooks; **decision needed** (§5). Short term: an "AI tutor prompt" block with a copy button and a link. |
| Quizlet                             | vocabulary flashcards per cycle                     | Replaced over time by in-platform vocabulary sets + flashcards (MVP); keep the link meanwhile.                                    |
| Tazman                              | link in every notebook header                       | Scheduling/booking system, out of scope here.                                                                                     |
| Adobe Acrobat / Google Docs / Gamma | worksheets (e.g. family tree)                       | Become `download` blocks with files in Storage, or stay as reviewed links.                                                        |
| Wheel of Names                      | random picker in class                              | `externalLink` block (allow-listed).                                                                                              |
| genius.com, Spotify, YouTube        | songs and lyrics (music cycle)                      | Links only; **do not copy lyrics** into the platform (copyright).                                                                 |
| Shop sites (Zara, H&M…)             | fashion cycle browsing                              | Links only.                                                                                                                       |

### 2.6 Quality issues found (to fix during conversion, not automatically)

- Spanish L1, "Amistades" class summary contains **English** grammar rules ("do not /
  does not", third-person "-s"): copied from the English notebook.
- Spanish and English homework instructions are near-identical across languages; some
  Spanish homework text still refers to English.
- Heavy manual formatting (bold/italic markers, empty lines, stray "\*\*") that a
  converter must clean.

## 3. Revised block catalogue (v1.1)

The v1 catalogue in CONTENT-MODEL.md holds. The audit adds these blocks:

| Block                 | What it holds                                                                                           | Student view                              | Teacher view                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------- |
| `cycleOverview`       | the cycle's 2 skills, which activities practise each, recommended pairs                                 | skills only                               | everything                                         |
| `sentenceFrame`       | a prompt with blanks ("Me gusta ____ con mi ____") and optional example                                 | yes, can be answered (saved, not graded)  | yes                                                |
| `discussionQuestions` | warm-up/intro questions, each with an optional sentence frame                                           | yes                                       | yes + timing                                       |
| `classActivity`       | title, grammar-focus skills, duration, stages, example, optional word bank / model structure / resource | student-facing instructions and materials | + stages, timing, grouping (pairs, breakout rooms) |
| `wordBank`            | words to use in an activity                                                                             | yes                                       | yes                                                |
| `ruleSummary`         | a skill, its rules, examples, optional table                                                            | yes                                       | yes                                                |
| `aiTutorPrompt`       | a message to send to the AI tutor, with copy button                                                     | yes                                       | yes                                                |
| `externalLink`        | allow-listed external resource (Quizlet, Wheel of Names, Spotify…)                                      | yes                                       | yes                                                |

`teacherTip` and the per-student "answer slots" become **teacher-only notes** (the slots
are replaced by the platform's own records of what students answered).

## 4. Migration approach, confirmed

The pipeline in CONTENT-MODEL.md §6.3 stands, with three refinements:

1. Convert **one cycle** of Spanish L1 first (e.g. Family) and have a teacher review both
   views before doing the rest. Measure the hours.
2. Build the converter around the template in §2.3 (Spanish/English); write a separate
   mapping for Arabic.
3. Export from Google Docs as **DOCX or HTML** (keeps tables and images) rather than the
   text representation used for this audit.

## 5. Decisions (answered 2026-10-03)

| #   | Question                                           | Decision                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | What to do with **Mori** (the AI chat tutor)       | **Link out.** The platform shows each homework prompt with a copy button and an "Open Mori" link (one link per course, `courses.ai_tutor_url`). No student data passes through the platform. The Mori link itself is still to be supplied. |
| C2  | Should students type answers in class?             | **Optional.** Students may type answers into sentence frames on their own device; answers are saved privately and visible to their own teacher. The shared screen keeps working.                                                           |
| C3  | Shared cycle catalogue across languages (ADR-021)? | **No.** Cycles stay per course. ADR-021 is recorded as rejected.                                                                                                                                                                           |
| C4  | Pilot course                                       | **English Foundations (L1), owned by New School.** Its files should still move to a school-owned Google account (§6).                                                                                                                      |

## 6. Ownership warning

The audited notebooks are owned by a **personal Gmail account** and shared with the
school, not owned by a New School account. As with the code, the school's teaching
material should belong to the school: move the files to a New School Google Workspace
(or shared drive) owned by at least two school accounts, and record who holds the rights
to the content before it is converted into the platform.
