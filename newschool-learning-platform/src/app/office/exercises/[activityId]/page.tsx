import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { StaffExerciseEditPage } from '@/app/_exercises/StaffExerciseEditPage';
import {
  assignOfficeExercise,
  removeOfficeAssignment,
  saveOfficeExerciseContent,
  saveOfficeExerciseMeta,
  setOfficeExerciseStatus,
} from '@/server/actions/staff-exercises';
import { requireArea } from '@/server/auth/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('cms.activity'))('metaTitle') };
}

export default async function OfficeExercisePage({
  params,
}: {
  params: Promise<{ activityId: string }>;
}) {
  const user = await requireArea('office');
  const id = z.uuid().safeParse((await params).activityId);
  if (!id.success) notFound();
  return (
    <StaffExerciseEditPage
      area="office"
      user={user}
      activityId={id.data}
      actions={{
        saveMeta: saveOfficeExerciseMeta,
        saveContent: saveOfficeExerciseContent,
        setStatus: setOfficeExerciseStatus,
        assign: assignOfficeExercise,
        removeAssignment: removeOfficeAssignment,
      }}
    />
  );
}
