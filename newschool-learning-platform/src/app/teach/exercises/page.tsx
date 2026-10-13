import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StaffExercisesPage } from '@/app/_exercises/StaffExercisesPage';
import { createTeacherExercise } from '@/server/actions/staff-exercises';
import { requireArea } from '@/server/auth/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('exercises.list'))('titleTeach') };
}

export default async function TeacherExercisesPage() {
  const user = await requireArea('teach');
  return <StaffExercisesPage area="teach" user={user} createAction={createTeacherExercise} />;
}
