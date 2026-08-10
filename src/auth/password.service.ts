import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * argon2id with OWASP's baseline parameters. Chosen over bcrypt for its memory
 * hardness (19 MiB per hash), which is what makes GPU cracking expensive, and
 * because it has no 72-byte input limit.
 */
const OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, OPTIONS);
  }

  /**
   * Burns the same work as a real verification when no user was found, so login
   * response time does not reveal which emails are registered. Always false.
   */
  async verifyDummy(plain: string): Promise<false> {
    const pending = (this.dummyHash ??= argon2.hash('unused-placeholder-password', OPTIONS));
    await argon2.verify(await pending, plain).catch(() => false);
    return false;
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // A malformed hash in the database should read as "wrong password",
      // not crash the login endpoint.
      return false;
    }
  }
}
