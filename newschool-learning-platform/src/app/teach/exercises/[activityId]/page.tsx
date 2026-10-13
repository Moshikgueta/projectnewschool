import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { StaffExerciseEditPage } from '@/app/_exercises/StaffExerciseEditPage';
import {
  saveTeacherExerciseContent,
  saveTeacherExerciseMeta,
  setTeacherExerciseStatus,
} from '@/server/actions/staff-exercises';
import { assignActivity, removeAssignment } from '@/server/actions/teach';
import { requireArea } from '@/server/auth/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('cms.activity'))('metaTitle') };
}

export default async function TeacherExercisePage({
  params,
}: {
  params: Promise<{ activityId: string }>;
}) {
  const user = await requireArea('teach');
  const id = z.uuid().safeParse((await params).activityId);
  if (!id.success) notFound();
  return (
    <StaffExerciseEditPage
      area="teach"
      user={user}
      activityId={id.data}
      actions={{
        saveMeta: saveTeacherExerciseMeta,
        saveContent: saveTeacherExerciseContent,
        setStatus: setTeacherExerciseStatus,
        // Teachers assign through the group action: their own groups only.
        assign: assignActivity,
        removeAssignment,
      }}
    />
  );
}
