'use client';

// One icon library (Phosphor), one weight, used through this map only, so the
// set stays consistent. Directional icons flip in right-to-left layouts.
import {
  ArrowRight,
  BookOpen,
  CalendarBlank,
  Cards,
  ChalkboardTeacher,
  ClipboardText,
  Door,
  Gear,
  House,
  NotePencil,
  Translate,
  UsersThree,
} from '@phosphor-icons/react';

export const ICONS = {
  home: House,
  notebook: BookOpen,
  workbook: NotePencil,
  practice: ClipboardText,
  vocabulary: Cards,
  groups: UsersThree,
  teach: ChalkboardTeacher,
  settings: Gear,
  language: Translate,
  timetable: CalendarBlank,
  rooms: Door,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  const Component = ICONS[name];
  return <Component aria-hidden="true" className={className} weight="regular" />;
}

export function ForwardArrow({ className = 'size-4' }: { className?: string }) {
  return <ArrowRight aria-hidden="true" className={`rtl:-scale-x-100 ${className}`} />;
}
