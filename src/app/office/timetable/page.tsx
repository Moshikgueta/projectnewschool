import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getBookingChoices, getTimetable } from '@/server/queries/timetable';
import { requireArea } from '@/server/auth/session';
import { Card } from '@/ui/Card';
import { PageTitle, Section } from '@/ui/Page';
import { TimetableGrid, weekdayNames } from '../../_timetable/TimetableGrid';
import { BookingForm } from '../OfficeForms';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('office.timetable'))('title') };
}

export default async function OfficeTimetablePage() {
  await requireArea('office');
  const [t, { rooms, bookings }, choices, days] = await Promise.all([
    getTranslations('office.timetable'),
    getTimetable(),
    getBookingChoices(),
    weekdayNames(),
  ]);
  const activeRooms = rooms.filter((r) => r.active);

  return (
    <div className="flex flex-col gap-8">
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      <TimetableGrid rooms={rooms} bookings={bookings} editable />
      {activeRooms.length ? (
        <Section id="book-heading" title={t('add')}>
          <Card>
            <BookingForm
              rooms={activeRooms.map((r) => ({ id: r.id, name: r.name }))}
              groups={choices.groups}
              teachers={choices.teachers}
              days={[0, 1, 2, 3, 4, 5].map((d) => ({ value: d, label: days[d] ?? '' }))}
            />
          </Card>
        </Section>
      ) : null}
    </div>
  );
}
