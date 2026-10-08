# Stage F privacy review: admissions and teacher development

Status: **proposal, waiting for the school's decisions** · 2026-10-07

Stage F of the staff-room merge ([STAFF-ROOM-MERGE.md](STAFF-ROOM-MERGE.md)) moves the
two most sensitive screens: admissions (people who are not students yet) and teacher
development (records about staff). This page gives the facts from the staff room, a
recommended design for each, and the decisions the school has to make. Nothing in this
stage is built until those decisions are made.

The legal points below come from privacy principles the platform already follows
([SECURITY.md](SECURITY.md) §4): collect only what is needed, limit who sees it, keep it
only as long as needed, and let people see data about themselves. They are not legal
advice: the school's legal adviser should confirm retention periods and access rights
under Israeli privacy law.

## What the staff room has today

Both screens keep their data only in each browser's localStorage, so nothing is shared
and nothing is really protected. The only real block is that the teacher role can't open
them; the other roles are kept apart only by which menu links they see.

**Admissions (קבלה ורישום).** For each prospect: name, phone, language, level, private or
group, goal (free text), source (Instagram, Google, referral, WhatsApp, website, phone),
status (new → contacted → trial booked → trial held → enrolled / not relevant), trial
lesson time and teacher, follow-up date and free notes. No email, no dates of creation or
change, no record of who handled it. Leads are deleted with no confirmation and no
archive. "Enrolled" changes the status only: no student record is created. One seed
note names the current student who made the referral (a third person's data).

**Teacher development (פיתוח מורים).** For each teacher: three training meetings
(attended or not), documents as Google Drive links (CV, teaching certificate,
recommendation, employment confirmation, other), interview summaries (free text) and
"my impressions" (free text, marked internal). No ratings, salary, ID numbers or bank
details. The page says the record is hidden from the teacher, and that impressions are
hidden from the office; in practice the admin role can read everything.

**Teacher roster.** Name, language, status and a note only. Nothing more sensitive.

## Recommended design: admissions

| Topic               | Recommendation                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What is kept        | The staff room's fields, with structured dates (trial time, follow-up date), plus optional email, created/changed dates and who handled the lead. Goal and notes limited to short text, with a hint not to write about other people (for example "referred by a student", not their name). |
| Who sees it         | The office and admins, with the second sign-in step. The pedagogical manager sees counts only (by status and source), not people. A teacher assigned to a trial lesson sees only the first name, language, level, goal and time of that trial: no phone or notes.                          |
| Enrolment           | "Enrolled" becomes a real action: it creates the student (as the office's "Add a student" does today) with the lead's contact details, then removes the lead.                                                                                                                              |
| How long it is kept | A lead that does not enrol is deleted automatically **12 months after its last change**. "Not relevant" leads, **3 months** after being marked. The office can delete a lead at any time, for example when the person asks.                                                                |
| Deletion            | Deletions ask for confirmation and are recorded in the audit log without the lead's content (who deleted which lead, and when).                                                                                                                                                            |
| Messages            | The outreach message template stays copy-only. Nothing is sent automatically.                                                                                                                                                                                                              |
| Minors              | Depends on decision D7: if prospects can be under 18, a parent's contact details and consent are needed, and the form changes.                                                                                                                                                             |

## Recommended design: teacher development

| Topic                  | Recommendation                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is kept           | Training meetings attended, document links (https only, as for training links) with their type, interview summaries, impressions. Nothing more: no ratings, salary, ID numbers or bank details, as today.                                                           |
| Who sees it            | **The pedagogical manager only**, with the second sign-in step. Not admins (a technical role) and not the office. If an admin must sometimes see it, that becomes a separate, logged permission.                                                                    |
| The teacher's own view | The teacher sees their own training meetings and the list of documents they provided. **Decision needed** on interview summaries and impressions (see below).                                                                                                       |
| Every read is logged   | Opening a teacher's record is written to the audit log (who, whose record, when), not only changes.                                                                                                                                                                 |
| How long it is kept    | While the teacher works at the school, then **2 years** after they leave, unless the law requires longer for some document. Deletion then removes the record and its links (the documents themselves stay in Google Drive, under the school's own retention rules). |
| Documents              | Links only; the platform stores no files. The Drive folder's own sharing must be limited to the pedagogical manager.                                                                                                                                                |

## Decisions the school needs to make

1. **Admissions access:** office and admins only, with the pedagogical manager seeing
   counts and trial teachers seeing only their trial (recommended)? Or should the
   pedagogical manager see prospects too?
2. **Admissions retention:** 12 months for leads that don't enrol, 3 months for "not
   relevant" (recommended), or other periods?
3. **Teacher development access:** pedagogical manager only (recommended), or also
   admins?
4. **The teacher's own record:** may teachers see their interview summaries and
   impressions? Recommended: yes for interview summaries. For impressions, either yes,
   written so the teacher could read them, or no, and the legal adviser confirms that
   this is allowed.
5. **Teacher development retention:** 2 years after a teacher leaves (recommended), or
   another period from the legal adviser?
6. **Minors (D7):** can students or prospects be under 18?

When these are answered, stage F is built like stages A–E: tables with forced RLS,
database tests for every role, end-to-end tests including forged requests, and the
answers recorded as an ADR.
