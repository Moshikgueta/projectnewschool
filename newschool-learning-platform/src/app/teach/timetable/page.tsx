import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireArea } from '@/server/auth/session';
import { getTimetable } from '@/server/queries/timetable';
import { PageTitle } from '@/ui/Page';
import { TimetableGrid } from '../../_timetable/TimetableGrid';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('office.timetable'))('title') };
}

/** The weekly timetable, read-only for teachers; their own lessons are marked. */
export default async function TeacherTimetablePage() {
  const user = await requireArea('teach');
  const [t, { rooms, bookings }] = await Promise.all([
    getTranslations('office.timetable'),
    getTimetable(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <PageTitle subtitle={`${t('readOnly')} ${t('mine')}`}>{t('title')}</PageTitle>
      <TimetableGrid
        rooms={rooms}
        bookings={bookings}
        editable={false}
        highlightTeacherId={user.id}
      />
    </div>
  );
}
