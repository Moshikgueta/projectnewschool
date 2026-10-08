import type { Metadata, Route } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireArea } from '@/server/auth/session';
import { getClassAttendance } from '@/server/queries/attendance';
import { ButtonLink } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { EmptyState, PageTitle } from '@/ui/Page';
import { AttendanceForm } from './AttendanceForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('teach.attendance'))('title') };
}

type Params = { params: Promise<{ groupId: string; sessionId: string }> };

export default async function AttendancePage({ params }: Params) {
  const user = await requireArea('teach');
  const raw = await params;
  const groupId = z.uuid().safeParse(raw.groupId);
  const sessionId = z.uuid().safeParse(raw.sessionId);
  if (!groupId.success || !sessionId.success) notFound();

  // Null unless the caller teaches the group and the class is one of its own:
  // reported exactly like a class that doesn't exist.
  const cls = await getClassAttendance(user.id, groupId.data, sessionId.data);
  if (!cls) notFound();

  const [t, format] = await Promise.all([getTranslations('teach.attendance'), getFormatter()]);
  const date = format.dateTime(new Date(cls.startsAt), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: user.timezone,
  });

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <ButtonLink
        href={`/teach/groups/${cls.groupId}` as Route}
        variant="tertiary"
        className="self-start"
      >
        {t('back')}
      </ButtonLink>
      <PageTitle subtitle={`${cls.groupName} · ${date}`}>{t('title')}</PageTitle>
      {!cls.open ? (
        <Card>
          <p className="text-fg-secondary">{t('notOpen')}</p>
        </Card>
      ) : cls.students.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <AttendanceForm groupId={cls.groupId} sessionId={cls.sessionId} students={cls.students} />
      )}
    </article>
  );
}
