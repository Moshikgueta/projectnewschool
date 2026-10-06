import { getFormatter, getTranslations } from 'next-intl/server';
import { formatTime, weekGrid } from '@/domain/scheduling/timetable';
import type { Booking, Room } from '@/server/queries/timetable';
import { deleteBooking } from '@/server/actions/office';

/** Weekday name for 0 = Sunday … 6 = Saturday (2026-10-04 was a Sunday). */
export async function weekdayNames(): Promise<string[]> {
  const format = await getFormatter();
  return Array.from({ length: 7 }, (_, d) =>
    format.dateTime(new Date(Date.UTC(2026, 9, 4 + d, 12)), { weekday: 'long', timeZone: 'UTC' }),
  );
}

/**
 * The week as a table: rooms down the side, school days across, each cell
 * listing its lessons in time order. Scrolls sideways on a phone. With
 * `editable` (office), each lesson has a remove button.
 */
export async function TimetableGrid({
  rooms,
  bookings,
  editable,
  highlightTeacherId,
}: {
  rooms: Room[];
  bookings: Booking[];
  editable: boolean;
  highlightTeacherId?: string;
}) {
  const [t, days] = await Promise.all([getTranslations('office.timetable'), weekdayNames()]);
  const grid = weekGrid(rooms, bookings);
  const shownRooms = grid[0]?.rooms.map((r) => r.room) ?? [];
  if (shownRooms.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-5 text-fg-secondary">
        {t('empty')}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[56rem] table-fixed text-[0.9375rem]">
        <caption className="sr-only">{t('title')}</caption>
        <thead className="bg-surface-secondary text-sm text-muted">
          <tr>
            <th scope="col" className="w-36 px-3 py-2 text-start font-medium">
              {t('room')}
            </th>
            {grid.map((day) => (
              <th key={day.weekday} scope="col" className="px-3 py-2 text-start font-medium">
                {days[day.weekday]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {shownRooms.map((room, r) => (
            <tr key={room.id} className="align-top">
              <th scope="row" className="px-3 py-3 text-start font-semibold">
                {room.name}
              </th>
              {grid.map((day) => (
                <td key={day.weekday} className="px-2 py-2">
                  <ul className="flex flex-col gap-2">
                    {day.rooms[r]!.bookings.map((b) => {
                      const mine = highlightTeacherId && b.teacherId === highlightTeacherId;
                      return (
                        <li
                          key={b.id}
                          className={`rounded-md border px-2 py-1.5 ${
                            mine
                              ? 'border-primary bg-primary-light'
                              : 'border-border bg-surface-secondary'
                          }`}
                        >
                          <p className="text-xs font-medium text-muted tabular-nums" dir="ltr">
                            {formatTime(b.start)}–{formatTime(b.end)}
                          </p>
                          <p className="font-medium" dir="auto">
                            {b.title}
                          </p>
                          {b.teacherName ? (
                            <p className="text-xs text-fg-secondary">
                              <bdi>{b.teacherName}</bdi>
                            </p>
                          ) : null}
                          {b.note ? (
                            <p className="text-xs text-muted" dir="auto">
                              {b.note}
                            </p>
                          ) : null}
                          {editable ? (
                            <form action={deleteBooking}>
                              <input type="hidden" name="id" value={b.id} />
                              <button
                                type="submit"
                                className="min-h-8 text-xs font-medium text-muted underline-offset-4 hover:text-fg hover:underline"
                                aria-label={t('removeLabel', {
                                  title: b.title,
                                  day: days[b.weekday] ?? '',
                                  from: formatTime(b.start),
                                })}
                              >
                                {t('remove')}
                              </button>
                            </form>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
