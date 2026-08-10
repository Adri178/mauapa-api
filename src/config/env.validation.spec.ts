import { validateEnv } from './env.validation';

const valid = {
  DATABASE_URL: 'postgresql://mauapa:mauapa@localhost:5432/mauapa?schema=public',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateEnv', () => {
  it('applies defaults for NODE_ENV and PORT', () => {
    const env = validateEnv(valid);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
  });

  it('coerces PORT to a number', () => {
    expect(validateEnv({ ...valid, PORT: '4000' }).PORT).toBe(4000);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => validateEnv({ REDIS_URL: valid.REDIS_URL })).toThrow(
      /Invalid environment variables/,
    );
  });

  it('throws on an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
