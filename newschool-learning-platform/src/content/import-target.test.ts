// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decideImportTarget } from './import-target';

const secret = 'not-a-real-key';
const remote = 'https://abcdefgh.supabase.co';
const target = (url: string, appEnv: string | undefined, ...argv: string[]) =>
  decideImportTarget({ url, secret, appEnv, argv });

describe('content import target', () => {
  it('imports into the local database without ceremony', () => {
    expect(target('http://127.0.0.1:54321', undefined).env).toBe('local');
    expect(target('http://localhost:54321', 'local').env).toBe('local');
  });

  it('needs the URL and the secret key', () => {
    expect(() => decideImportTarget({ url: '', secret, appEnv: 'local', argv: [] })).toThrow(
      /required/,
    );
    expect(() =>
      decideImportTarget({ url: 'http://127.0.0.1:54321', secret: '', appEnv: 'local', argv: [] }),
    ).toThrow(/required/);
  });

  it('imports into staging only with APP_ENV=staging and the host confirmed', () => {
    expect(target(remote, 'staging', '--confirm=abcdefgh.supabase.co').env).toBe('staging');
    expect(() => target(remote, 'staging')).toThrow(/Refusing/);
    expect(() => target(remote, 'staging', '--confirm=other.supabase.co')).toThrow(/Refusing/);
    expect(() => target(remote, undefined, '--confirm=abcdefgh.supabase.co')).toThrow(/Refusing/);
  });

  it('imports into production only with APP_ENV=production, --production and the host confirmed', () => {
    expect(target(remote, 'production', '--production', '--confirm=abcdefgh.supabase.co').env).toBe(
      'production',
    );
    expect(() => target(remote, 'production', '--confirm=abcdefgh.supabase.co')).toThrow(
      /--production/,
    );
    expect(() => target(remote, 'production', '--production')).toThrow(/Refusing/);
    expect(() =>
      target(remote, 'staging', '--production', '--confirm=abcdefgh.supabase.co'),
    ).not.toThrow();
    expect(() => target(remote, 'local', '--production', '--confirm=abcdefgh.supabase.co')).toThrow(
      /Refusing/,
    );
  });

  it('refuses plain http for a remote database, and a production label on a local URL', () => {
    expect(() =>
      target('http://db.example.com', 'production', '--production', '--confirm=db.example.com'),
    ).toThrow(/https/);
    expect(() => target('http://127.0.0.1:54321', 'production')).toThrow(/local database/);
  });
});
