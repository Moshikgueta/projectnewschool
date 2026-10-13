-- The school office ("מנהלת קבלה" in the staff room): runs rooms and the
-- weekly timetable now, and admissions and lesson packages later. Its own
-- migration because a new enum value cannot be used in the transaction that
-- adds it.
alter type public.app_role add value if not exists 'office';
