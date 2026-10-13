'use client';

import { useTranslations } from 'next-intl';
import { ActionForm } from '@/app/manage/ActionForm';
import { addBooking, deleteRoom, saveRoom } from '@/server/actions/office';
import { Button } from '@/ui/Button';
import { SelectField } from '@/ui/SelectField';
import { TextField } from '@/ui/TextField';

type Option = { id: string; name: string };

export function BookingForm({
  rooms,
  groups,
  teachers,
  days,
}: {
  rooms: Option[];
  groups: Option[];
  teachers: Option[];
  days: { value: number; label: string }[];
}) {
  const t = useTranslations('office.timetable');
  const none = { value: '', label: t('none') };
  return (
    <ActionForm action={addBooking} className="flex flex-col gap-3">
      {(pending) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              id="booking-room"
              name="roomId"
              label={t('room')}
              options={rooms.map((r) => ({ value: r.id, label: r.name }))}
            />
            <TextField
              id="booking-title"
              name="title"
              label={t('lessonTitle')}
              maxLength={160}
              required
            />
            <SelectField
              id="booking-group"
              name="groupId"
              label={t('group')}
              options={[none, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
            />
            <SelectField
              id="booking-teacher"
              name="teacherId"
              label={t('teacher')}
              options={[none, ...teachers.map((g) => ({ value: g.id, label: g.name }))]}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField
              id="booking-day"
              name="weekday"
              label={t('day')}
              options={days.map((d) => ({ value: String(d.value), label: d.label }))}
            />
            <TextField id="booking-from" name="from" type="time" label={t('from')} required />
            <TextField id="booking-to" name="to" type="time" label={t('to')} required />
          </div>
          <TextField id="booking-note" name="note" label={t('note')} maxLength={500} />
          <Button type="submit" loading={pending} className="self-start">
            {t('bookButton')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function RoomForm({
  room,
}: {
  room?: {
    id: string;
    name: string;
    capacity: number;
    kit: string;
    active: boolean;
    sortOrder: number;
  };
}) {
  const t = useTranslations('office.rooms');
  const key = room?.id ?? 'new';
  return (
    <ActionForm
      action={saveRoom}
      hidden={room ? { id: room.id } : {}}
      className="flex flex-col gap-3"
    >
      {(pending) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              id={`room-name-${key}`}
              name="name"
              label={t('name')}
              defaultValue={room?.name}
              maxLength={80}
              required
            />
            <TextField
              id={`room-kit-${key}`}
              name="kit"
              label={t('kit')}
              defaultValue={room?.kit}
              maxLength={300}
            />
            <TextField
              id={`room-capacity-${key}`}
              name="capacity"
              type="number"
              min={0}
              max={500}
              label={t('capacity')}
              defaultValue={room?.capacity ?? 0}
            />
            <TextField
              id={`room-order-${key}`}
              name="sortOrder"
              type="number"
              min={0}
              max={1000}
              label={t('sortOrder')}
              defaultValue={room?.sortOrder ?? 0}
            />
            <SelectField
              id={`room-active-${key}`}
              name="active"
              label={t('active')}
              defaultValue={room && !room.active ? 'false' : 'true'}
              options={[
                { value: 'true', label: t('active') },
                { value: 'false', label: t('inactive') },
              ]}
            />
          </div>
          <Button
            type="submit"
            variant={room ? 'secondary' : 'primary'}
            loading={pending}
            className="self-start"
          >
            {room ? t('save') : t('add')}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function DeleteRoomForm({ id, name }: { id: string; name: string }) {
  const t = useTranslations('office.rooms');
  return (
    <ActionForm action={deleteRoom} hidden={{ id }} className="flex flex-col gap-2">
      {(pending) => (
        <Button
          type="submit"
          variant="tertiary"
          loading={pending}
          aria-label={t('removeLabel', { name })}
        >
          {t('remove')}
        </Button>
      )}
    </ActionForm>
  );
}
