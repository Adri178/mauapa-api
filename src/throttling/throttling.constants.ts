/**
 * Per-route limits, as plain constants rather than configuration.
 *
 * @Throttle is evaluated when the module is imported, which happens before
 * ConfigModule has loaded .env — so a decorator cannot read config without
 * reading a value that is not there yet. These numbers also express intent
 * ("brute-forcing a password should be slow") rather than deployment tuning,
 * so pinning them in code keeps the intent next to the route it protects.
 * The global default limit stays configurable.
 */

const MINUTE = 60_000;

/**
 * Credentials endpoints. Tight, because this is the window an attacker uses to
 * guess passwords, and a real person logs in a handful of times a day.
 */
export const AUTH_THROTTLE = { default: { limit: 10, ttl: MINUTE } };

/**
 * Registration. Tighter still: signing up is rare, and the endpoint creates
 * rows and burns an argon2 hash on every call.
 */
export const REGISTER_THROTTLE = { default: { limit: 5, ttl: 10 * MINUTE } };

/**
 * Booking. Generous enough for someone losing a slot race and retrying, mean
 * enough to stop one customer sweeping a whole day's diary.
 */
export const BOOKING_THROTTLE = { default: { limit: 20, ttl: MINUTE } };
