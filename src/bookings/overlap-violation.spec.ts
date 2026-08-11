import { OVERLAP_CONSTRAINT, isDeadlock, isOverlapViolation } from './overlap-violation';

// Taken verbatim from a real rejection by the running database.
const REAL_MESSAGE = `
Invalid \`prisma.booking.create()\` invocation:

Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23P01", message: "conflicting key value violates exclusion constraint \\"${OVERLAP_CONSTRAINT}\\"", severity: "ERROR" }) })
`;

describe('isOverlapViolation', () => {
  it('recognises the real rejection Postgres produces', () => {
    expect(isOverlapViolation(new Error(REAL_MESSAGE))).toBe(true);
  });

  it('recognises the SQLSTATE alone', () => {
    expect(isOverlapViolation(new Error('PostgresError { code: "23P01" }'))).toBe(true);
  });

  it('recognises the constraint name alone', () => {
    expect(isOverlapViolation(new Error(`violates constraint "${OVERLAP_CONSTRAINT}"`))).toBe(true);
  });

  it('does not mistake a unique violation for a taken slot', () => {
    expect(isOverlapViolation(new Error('PostgresError { code: "23505" }'))).toBe(false);
  });

  it('does not mistake a foreign-key violation for a taken slot', () => {
    expect(isOverlapViolation(new Error('PostgresError { code: "23503" }'))).toBe(false);
  });

  it('does not mistake a dropped connection for a taken slot', () => {
    expect(isOverlapViolation(new Error("Can't reach database server at localhost:5432"))).toBe(
      false,
    );
  });

  it('is false for a non-error value', () => {
    expect(isOverlapViolation('23P01')).toBe(false);
    expect(isOverlapViolation(null)).toBe(false);
    expect(isOverlapViolation(undefined)).toBe(false);
  });

  it('does not treat a deadlock as a taken slot', () => {
    // A deadlock victim never learned whether the slot was free, so answering
    // 409 would be a guess. It must be retried instead.
    expect(isOverlapViolation(new Error('PostgresError { code: "40P01" }'))).toBe(false);
  });
});

describe('isDeadlock', () => {
  it('recognises deadlock_detected', () => {
    expect(
      isDeadlock(new Error('PostgresError { code: "40P01", message: "deadlock detected" }')),
    ).toBe(true);
  });

  it('does not confuse it with an exclusion violation', () => {
    expect(isDeadlock(new Error('PostgresError { code: "23P01" }'))).toBe(false);
  });

  it('does not confuse it with a serialization failure', () => {
    expect(isDeadlock(new Error('PostgresError { code: "40001" }'))).toBe(false);
  });

  it('is false for a non-error value', () => {
    expect(isDeadlock('40P01')).toBe(false);
    expect(isDeadlock(null)).toBe(false);
  });
});
