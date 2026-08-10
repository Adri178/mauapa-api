import { validateEnv } from './env.validation';

const valid = {
  DATABASE_URL: 'postgresql://mauapa:mauapa@localhost:5432/mauapa?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults for NODE_ENV, PORT, and token lifetimes', () => {
    const env = validateEnv(valid);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.JWT_REFRESH_TTL).toBe('7d');
  });

  it('coerces PORT to a number', () => {
    expect(validateEnv({ ...valid, PORT: '4000' }).PORT).toBe(4000);
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = valid;

    expect(() => validateEnv(withoutDb)).toThrow(/Invalid environment variables/);
  });

  it('throws on an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('rejects a token lifetime that is not an ms duration', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_TTL: '15min' })).toThrow(/JWT_ACCESS_TTL/);
    expect(() => validateEnv({ ...valid, JWT_REFRESH_TTL: 'forever' })).toThrow(/JWT_REFRESH_TTL/);
  });

  it('accepts valid ms durations', () => {
    const env = validateEnv({ ...valid, JWT_ACCESS_TTL: '3600s', JWT_REFRESH_TTL: '30d' });

    expect(env.JWT_ACCESS_TTL).toBe('3600s');
    expect(env.JWT_REFRESH_TTL).toBe('30d');
  });
});
