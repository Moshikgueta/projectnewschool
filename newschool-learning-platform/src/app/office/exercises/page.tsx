import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StaffExercisesPage } from '@/app/_exercises/StaffExercisesPage';
import { createOfficeExercise } from '@/server/actions/staff-exercises';
import { requireArea } from '@/server/auth/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('exercises.list'))('titleOffice') };
}

export default async function OfficeExercisesPage() {
  const user = await requireArea('office');
  return <StaffExercisesPage area="office" user={user} createAction={createOfficeExercise} />;
}
