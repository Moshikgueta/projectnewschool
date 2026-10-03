// Who may enter which area of the app. Pure functions: no I/O, no framework.
// The database enforces the same rules again with Row Level Security; this
// layer decides what to *show* (and where to send people), not what data
// they may read.

export const ROLES = ['student', 'teacher', 'pedagogical_manager', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export type AssuranceLevel = 'aal1' | 'aal2';

export const AREAS = {
  learn: { role: 'student', requiresMfa: false },
  teach: { role: 'teacher', requiresMfa: false },
  manage: { role: 'pedagogical_manager', requiresMfa: true },
  admin: { role: 'admin', requiresMfa: true },
} as const satisfies Record<string, { role: Role; requiresMfa: boolean }>;

export type Area = keyof typeof AREAS;

export type AccessSubject = {
  roles: readonly Role[];
  aal: AssuranceLevel;
};

export type AccessDecision = 'allow' | 'sign-in' | 'needs-mfa' | 'not-found';

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Decide whether a user may open an area. A user without the role gets
 * 'not-found' rather than 'forbidden', so the app never confirms that a staff
 * area exists to someone who may not use it.
 */
export function decideAccess(subject: AccessSubject | null, area: Area): AccessDecision {
  if (!subject) return 'sign-in';
  const rule = AREAS[area];
  if (!subject.roles.includes(rule.role)) return 'not-found';
  if (rule.requiresMfa && subject.aal !== 'aal2') return 'needs-mfa';
  return 'allow';
}

// Where someone lands after signing in. Daily-use areas come first: a teacher
// who is also a pedagogical manager starts in their groups.
const HOME_PRIORITY: readonly Area[] = ['teach', 'learn', 'manage', 'admin'];

export function homeAreaFor(roles: readonly Role[]): Area | null {
  return HOME_PRIORITY.find((area) => roles.includes(AREAS[area].role)) ?? null;
}

/** Whether an account holds any role whose area requires MFA. */
export function needsMfaEnrollment(roles: readonly Role[]): boolean {
  return (Object.values(AREAS) as { role: Role; requiresMfa: boolean }[]).some(
    (rule) => rule.requiresMfa && roles.includes(rule.role),
  );
}

/**
 * Accept a post-login redirect target only if it is a path on this site.
 * Rejects absolute URLs, protocol-relative URLs ("//evil.example") and
 * backslash tricks ("/\\evil.example") — the classic open-redirect vectors.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}
