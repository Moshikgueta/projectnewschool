import { NextResponse, type NextRequest } from 'next/server';
import { safeNextPath } from '@/domain/auth/access';
import { confirmEmailLink } from '@/server/auth/email-link';

// Target of invite and password-reset emails (supabase/templates/*.html).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const ok = await confirmEmailLink(searchParams.get('token_hash'), searchParams.get('type'));
  const target = ok ? safeNextPath(searchParams.get('next'), '/') : '/login?error=link';
  return NextResponse.redirect(new URL(target, origin));
}
