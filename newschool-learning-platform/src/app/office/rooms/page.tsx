import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireArea } from '@/server/auth/session';
import { getTimetable } from '@/server/queries/timetable';
import { Badge, Card } from '@/ui/Card';
import { PageTitle, Section } from '@/ui/Page';
import { DeleteRoomForm, RoomForm } from '../OfficeForms';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('office.rooms'))('title') };
}

export default async function RoomsPage() {
  await requireArea('office');
  const [t, { rooms }] = await Promise.all([getTranslations('office.rooms'), getTimetable()]);
  return (
    <div className="flex flex-col gap-8">
      <PageTitle subtitle={t('subtitle')}>{t('title')}</PageTitle>
      {rooms.length === 0 ? <p className="text-fg-secondary">{t('empty')}</p> : null}
      <ul className="flex flex-col gap-4">
        {rooms.map((room) => (
          <li key={room.id}>
            <Card className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{room.name}</h2>
                <span className="flex items-center gap-2">
                  <Badge tone={room.active ? 'success' : 'neutral'}>
                    {room.active ? t('active') : t('inactive')}
                  </Badge>
                  <span className="text-sm text-muted">{t('seats', { count: room.capacity })}</span>
                </span>
              </div>
              <details>
                <summary className="cursor-pointer font-medium text-primary">{t('edit')}</summary>
                <div className="mt-3 flex flex-col gap-3">
                  <RoomForm room={room} />
                  <DeleteRoomForm id={room.id} name={room.name} />
                </div>
              </details>
            </Card>
          </li>
        ))}
      </ul>
      <Section id="add-room-heading" title={t('add')}>
        <Card>
          <RoomForm />
        </Card>
      </Section>
    </div>
  );
}
