import type { TransformFnParams } from 'class-transformer';

/**
 * class-transformer types the incoming value as `any`. Narrowing it here keeps
 * every DTO free of unsafe-any handling, and leaves non-string input untouched
 * so class-validator still reports the real type error.
 */
export const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const normaliseEmail = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
