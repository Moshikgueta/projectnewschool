'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireArea } from '@/server/auth/session';
import { createPrivilegedClient } from '@/server/privileged/admin-client';

// "Not now" on a suggestion (ADR-010: only feedback is stored, never the
// list itself). Students have read-only access to recommendation_feedback;
// the server writes the row for the session's user, so a request can only
// ever snooze the caller's own suggestions.

const recKey = z.string().regex(/^[a-z-]+:[A-Za-z0-9:_-]{1,200}$/);

export async function dismissRecommendation(formData: FormData): Promise<void> {
  const user = await requireArea('learn');
  const key = recKey.safeParse(formData.get('key'));
  // Teacher assignments are not suggestions: they cannot be snoozed.
  if (!key.success || key.data.startsWith('assignment:')) return;

  await createPrivilegedClient()
    .from('recommendation_feedback')
    .upsert(
      { user_id: user.id, rec_key: key.data, action: 'dismissed', at: new Date().toISOString() },
      { onConflict: 'user_id,rec_key,action' },
    );
  revalidatePath('/learn');
}
