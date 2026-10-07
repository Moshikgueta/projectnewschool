import 'server-only';
import type { SessionUser } from '@/server/auth/session';
import type { Database } from '@/server/db.types';
import { createPrivilegedClient } from './admin-client';

type EventType = Database['public']['Enums']['learning_event_type'];

/**
 * Append a learning event (history used for progress and recent activity).
 * Students have no write access to learning_events, so the server records
 * them; the user id comes from the verified session object, never from input.
 */
export async function recordLearningEvent(
  user: SessionUser,
  type: EventType,
  refs: {
    courseId?: string;
    cycleId?: string | null;
    sectionId?: string;
    activityId?: string;
  } = {},
): Promise<void> {
  const client = createPrivilegedClient();
  await client.from('learning_events').insert({
    user_id: user.id,
    type,
    course_id: refs.courseId ?? null,
    cycle_id: refs.cycleId ?? null,
    section_id: refs.sectionId ?? null,
    activity_id: refs.activityId ?? null,
  });
}
