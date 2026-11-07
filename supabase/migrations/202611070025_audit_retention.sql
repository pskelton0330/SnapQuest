begin;

-- Owner decision: diagnostic audit events must be retained beyond 365 days.
-- Do not add automatic deletion here. Migration 029 also removes this behavior
-- from any database where an earlier draft of this migration was applied.

commit;
