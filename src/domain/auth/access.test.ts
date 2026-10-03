import { describe, expect, it } from 'vitest';
import {
  decideAccess,
  homeAreaFor,
  isRole,
  needsMfaEnrollment,
  safeNextPath,
  type AccessSubject,
} from './access';

const student: AccessSubject = { roles: ['student'], aal: 'aal1' };
const teacher: AccessSubject = { roles: ['teacher'], aal: 'aal1' };
const manager: AccessSubject = { roles: ['pedagogical_manager'], aal: 'aal1' };
const managerMfa: AccessSubject = { roles: ['pedagogical_manager'], aal: 'aal2' };
const adminMfa: AccessSubject = { roles: ['admin'], aal: 'aal2' };

describe('decideAccess', () => {
  it('sends signed-out visitors to sign in for every area', () => {
    for (const area of ['learn', 'teach', 'manage', 'admin'] as const) {
      expect(decideAccess(null, area)).toBe('sign-in');
    }
  });

  it('lets a student into learn and nowhere else', () => {
    expect(decideAccess(student, 'learn')).toBe('allow');
    expect(decideAccess(student, 'teach')).toBe('not-found');
    expect(decideAccess(student, 'manage')).toBe('not-found');
    expect(decideAccess(student, 'admin')).toBe('not-found');
  });

  it('lets a teacher into teach without MFA, but not into learn', () => {
    expect(decideAccess(teacher, 'teach')).toBe('allow');
    expect(decideAccess(teacher, 'learn')).toBe('not-found');
  });

  it('requires MFA for manager and admin areas', () => {
    expect(decideAccess(manager, 'manage')).toBe('needs-mfa');
    expect(decideAccess(managerMfa, 'manage')).toBe('allow');
    expect(decideAccess(adminMfa, 'admin')).toBe('allow');
    expect(decideAccess({ roles: ['admin'], aal: 'aal1' }, 'admin')).toBe('needs-mfa');
  });

  it('does not let MFA stand in for a missing role', () => {
    expect(decideAccess(managerMfa, 'admin')).toBe('not-found');
    expect(decideAccess(adminMfa, 'manage')).toBe('not-found');
  });
});

describe('homeAreaFor', () => {
  it('routes each role to its own area', () => {
    expect(homeAreaFor(['student'])).toBe('learn');
    expect(homeAreaFor(['teacher'])).toBe('teach');
    expect(homeAreaFor(['pedagogical_manager'])).toBe('manage');
    expect(homeAreaFor(['admin'])).toBe('admin');
  });

  it('prefers the daily-use area for people with several roles', () => {
    expect(homeAreaFor(['pedagogical_manager', 'teacher'])).toBe('teach');
    expect(homeAreaFor(['admin', 'pedagogical_manager'])).toBe('manage');
  });

  it('returns null for an account without roles', () => {
    expect(homeAreaFor([])).toBeNull();
  });
});

describe('needsMfaEnrollment', () => {
  it('is true only for roles with MFA-protected areas', () => {
    expect(needsMfaEnrollment(['student'])).toBe(false);
    expect(needsMfaEnrollment(['teacher'])).toBe(false);
    expect(needsMfaEnrollment(['teacher', 'pedagogical_manager'])).toBe(true);
    expect(needsMfaEnrollment(['admin'])).toBe(true);
  });
});

describe('isRole', () => {
  it('accepts only known roles', () => {
    expect(isRole('student')).toBe(true);
    expect(isRole('superuser')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

describe('safeNextPath', () => {
  it('keeps same-site paths', () => {
    expect(safeNextPath('/learn')).toBe('/learn');
    expect(safeNextPath('/admin?tab=users')).toBe('/admin?tab=users');
  });

  it('rejects open-redirect attempts', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'learn',
      '/learn\n',
      '',
    ]) {
      expect(safeNextPath(bad, '/')).toBe('/');
    }
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath(undefined, '/login')).toBe('/login');
  });
});
