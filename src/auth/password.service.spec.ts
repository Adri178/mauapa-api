import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('produces an argon2id digest, not the plaintext', async () => {
    const hash = await passwords.hash('correct-horse-battery-staple');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('correct-horse-battery-staple');
  });

  it('salts each hash, so identical passwords differ', async () => {
    const [a, b] = await Promise.all([
      passwords.hash('same-password'),
      passwords.hash('same-password'),
    ]);

    expect(a).not.toBe(b);
  });

  it('verifies a correct password', async () => {
    const hash = await passwords.hash('correct-horse-battery-staple');

    await expect(passwords.verify(hash, 'correct-horse-battery-staple')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await passwords.hash('correct-horse-battery-staple');

    await expect(passwords.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('returns false rather than throwing on a malformed digest', async () => {
    await expect(passwords.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('verifyDummy always returns false', async () => {
    await expect(passwords.verifyDummy('anything')).resolves.toBe(false);
  });
});
