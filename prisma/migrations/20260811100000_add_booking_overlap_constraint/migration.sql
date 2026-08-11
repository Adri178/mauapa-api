-- The anti-double-booking guard.
--
-- Application code cannot make this safe on its own: any "check then insert"
-- has a window between the two statements in which a second request can pass
-- the same check. Two concurrent bookings would both see a free slot and both
-- insert. Locking rows does not help either, because the row that must not
-- exist yet cannot be locked.
--
-- So the rule lives in the database, as a constraint Postgres enforces on
-- every insert regardless of how many connections race:
--
--   no two bookings for the SAME staff member may have OVERLAPPING time ranges
--
-- `EXCLUDE USING gist` is exactly that: staff_id compared with =, the time
-- range compared with && (overlap). btree_gist (enabled in the first migration)
-- is what lets an equality column and a range column live in one GiST index.
--
-- The range is '[)' — half-open. A booking ending at 10:00 and one starting at
-- 10:00 do not overlap, so back-to-back appointments remain legal.
--
-- The WHERE clause makes it a partial constraint: a cancelled booking releases
-- its slot instead of blocking it forever.
--
-- Prisma cannot express any of this, hence raw SQL.

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlapping_per_staff"
  EXCLUDE USING gist (
    "staff_id" WITH =,
    tstzrange("start_time", "end_time", '[)') WITH &&
  )
  WHERE ("status" <> 'CANCELLED');

-- Reject zero-length and inverted ranges outright; without this, an end before
-- its start would slip past the exclusion constraint (an empty range overlaps
-- nothing) and sit in the diary as a nonsensical row.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_end_after_start" CHECK ("end_time" > "start_time");
