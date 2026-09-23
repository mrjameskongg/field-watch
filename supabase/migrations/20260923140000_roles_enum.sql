-- Two roles the proposal promised: the weighbridge / warehouse team and the
-- quality officer. Kept in its own file because Postgres will not let a new
-- enum value be used in the same transaction that adds it.

alter type public.app_role add value if not exists 'warehouse';
alter type public.app_role add value if not exists 'quality_officer';
