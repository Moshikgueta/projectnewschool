import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { decideAccess } from '@/domain/auth/access';
import { getSessionUser } from '@/server/auth/session';
import { isProductionLike } from '@/server/env';
import { Alert } from '@/ui/Alert';
import { Button } from '@/ui/Button';
import { Avatar, Badge, Card, LanguageChip } from '@/ui/Card';
import { Dialog } from '@/ui/Dialog';
import { Logo } from '@/ui/Logo';
import { NavLinks } from '@/ui/NavLinks';
import { EmptyState, ErrorState, PageTitle, Section, Skeleton, Spinner } from '@/ui/Page';
import { ProgressBar, Stat } from '@/ui/Progress';
import { Tabs } from '@/ui/Tabs';
import { TextField } from '@/ui/TextField';
import { TokenSwatch } from '@/ui/TokenSwatch';

export const metadata: Metadata = { title: 'Design system' };

const TOKENS = [
  '--color-brand-primary',
  '--color-brand-primary-hover',
  '--color-brand-primary-light',
  '--color-brand-secondary',
  '--color-brand-secondary-light',
  '--color-brand-accent',
  '--color-background',
  '--color-surface',
  '--color-surface-secondary',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-muted',
  '--color-border',
  '--color-success',
  '--color-warning',
  '--color-error',
  '--color-info',
];

const TYPE_SCALE = [
  ['Display', 'text-4xl font-semibold'],
  ['Page title', 'text-3xl font-semibold'],
  ['Section heading', 'text-2xl font-semibold'],
  ['Sub-heading', 'text-lg font-semibold'],
  ['Body / notebook reading', 'text-[1.0625rem]'],
  ['Exercise instruction', 'text-[1.0625rem] font-medium'],
  ['UI label', 'text-[0.9375rem] font-medium'],
  ['Caption', 'text-sm text-muted'],
] as const;

/**
 * Internal visual reference (DESIGN-SYSTEM.md §10). Open in local and
 * preview builds; in staging and production only for pedagogical managers
 * and admins with MFA. Internal tool, so English only.
 */
export default async function DesignSystemPage() {
  if (isProductionLike()) {
    const user = await getSessionUser();
    const allowed =
      decideAccess(user, 'manage') === 'allow' || decideAccess(user, 'admin') === 'allow';
    if (!allowed) notFound();
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-10">
      <PageTitle subtitle="Every New School screen is built from these parts. Brand values are placeholders until the official files arrive (brand/README.md).">
        New School design system
      </PageTitle>

      <Section id="logo" title="Logo">
        <Alert tone="warning">
          No official logo file exists yet. The component below is a text placeholder, not a drawing
          of the logo.
        </Alert>
        <div className="flex flex-wrap gap-8">
          <Card>
            <Logo />
          </Card>
          <Card>
            <Logo variant="mark" />
          </Card>
        </div>
      </Section>

      <Section id="colour" title="Colour tokens">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOKENS.map((token) => (
            <TokenSwatch key={token} token={token} />
          ))}
        </div>
      </Section>

      <Section id="type" title="Typography">
        <div className="flex flex-col gap-4">
          {TYPE_SCALE.map(([name, cls]) => (
            <div key={name} className="flex flex-col gap-1 border-b border-border pb-3">
              <span className="text-xs text-muted">{name}</span>
              <span className={cls}>Good evening, Daniel · ערב טוב, דניאל · مساء الخير</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="buttons" title="Buttons">
        <div className="flex flex-col gap-4">
          {(['primary', 'secondary', 'tertiary'] as const).map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-4">
              <span className="w-24 text-sm text-muted">{variant}</span>
              <Button variant={variant}>Continue</Button>
              <Button variant={variant} disabled>
                Disabled
              </Button>
              <Button variant={variant} loading>
                Saving
              </Button>
            </div>
          ))}
        </div>
      </Section>

      <Section id="inputs" title="Inputs">
        <div className="grid max-w-xl gap-4">
          <TextField id="ds-name" label="Name" hint="As it should appear to your teacher." />
          <TextField
            id="ds-error"
            label="Email"
            defaultValue="not-an-email"
            error="Enter a valid email address."
          />
        </div>
      </Section>

      <Section id="cards" title="Cards, badges and chips">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <span className="text-sm text-muted">Activity</span>
            <p className="mt-1 text-lg font-semibold">Restaurant vocabulary practice</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="brand">Assigned by your teacher</Badge>
              <Badge>Before class</Badge>
              <Badge tone="success">Completed</Badge>
              <Badge tone="warning">Due soon</Badge>
            </div>
          </Card>
          <Card>
            <div className="flex flex-col gap-3">
              <LanguageChip code="es" name="Español" />
              <LanguageChip code="ar" name="العربية" />
              <LanguageChip code="de" name="Deutsch" />
              <span className="flex items-center gap-2">
                <Avatar name="Daniel Levi" /> Daniel Levi
              </span>
            </div>
          </Card>
        </div>
      </Section>

      <Section id="progress" title="Progress">
        <Card>
          <dl className="grid gap-6 sm:grid-cols-3">
            <Stat label="Activities completed" value={12} />
            <Stat label="Days practised in the last 7 days" value="2 of 3">
              <ProgressBar label="Practice" value={66} valueText="2 of 3" />
            </Stat>
            <Stat label="Current cycle" value="40%">
              <ProgressBar label="Cycle" value={40} />
            </Stat>
          </dl>
        </Card>
      </Section>

      <Section id="feedback" title="Feedback and exercise states">
        <div className="grid gap-3">
          <Alert tone="success">Correct. ¡Muy bien!</Alert>
          <Alert tone="warning">Almost: check the accent on “está”.</Alert>
          <Alert tone="error">Not quite. Remember: gustar agrees with the thing liked.</Alert>
          <Alert tone="info">Tip: you can listen to the dialogue again.</Alert>
        </div>
      </Section>

      <Section id="states" title="Loading, empty and error states">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Spinner label="Loading" />
            </div>
          </Card>
          <EmptyState title="No courses yet">
            Your course appears here once you are enrolled.
          </EmptyState>
          <ErrorState title="Something went wrong">Try again in a moment.</ErrorState>
        </div>
      </Section>

      <Section id="overlays" title="Dialog and tabs">
        <div className="flex flex-col gap-6">
          <Dialog trigger="Open dialog" title="Leave this activity?" closeLabel="Close">
            Your answers are saved. You can continue later from your home page.
          </Dialog>
          <Tabs
            label="Example tabs"
            tabs={[
              { id: 'notebook', title: 'Notebook', content: <p>Notebook content.</p> },
              { id: 'workbook', title: 'Workbook', content: <p>Workbook content.</p> },
            ]}
          />
        </div>
      </Section>

      <Section id="navigation" title="Navigation (desktop rail)">
        <Card className="max-w-xs">
          <NavLinks
            variant="rail"
            label="Example navigation"
            items={[
              { href: '/design-system', label: 'Home', icon: 'home' },
              { href: '/learn/notebook', label: 'Notebook', icon: 'notebook' },
              { href: '/learn/vocabulary', label: 'Vocabulary', icon: 'vocabulary' },
            ]}
          />
        </Card>
      </Section>

      <Section id="rtl" title="Right-to-left">
        <div dir="rtl" lang="he" className="grid gap-4 sm:grid-cols-2">
          <Card>
            <p className="text-lg font-semibold">ערב טוב, דניאל</p>
            <p className="mt-1 text-fg-secondary">
              ספרדית · רמה 1 — <bdi lang="es">¿Cómo te llamas?</bdi>
            </p>
            <div className="mt-3">
              <ProgressBar label="התקדמות" value={60} />
            </div>
          </Card>
          <Card>
            <p className="text-lg font-semibold" lang="ar">
              مساء الخير
            </p>
            <div className="mt-3 flex gap-2">
              <Button>המשך ללמוד</Button>
              <Button variant="secondary">חזרה</Button>
            </div>
          </Card>
        </div>
      </Section>
    </div>
  );
}
