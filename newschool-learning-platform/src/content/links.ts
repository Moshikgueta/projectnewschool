// External links that course content may point to. Anything else is rejected
// by the content schema, so a typo or a pasted tracking link cannot reach students.
export const ALLOWED_LINK_HOSTS = [
  'quizlet.com',
  'wheelofnames.com',
  'open.spotify.com',
  'www.youtube.com',
  'youtube.com',
  'youtu.be',
  'genius.com',
  'docs.google.com',
  'drive.google.com',
] as const;

export function isAllowedLink(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_LINK_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
