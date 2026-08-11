/**
 * Rate limiting is off by default for the e2e suites: they make hundreds of
 * requests from one address, and every one of them would otherwise be counted
 * against a limit meant for a single human.
 *
 * The suite that is *about* rate limiting turns it back on by setting this
 * variable at the top of its own file, which runs after this one.
 */
process.env.THROTTLE_ENABLED = process.env.THROTTLE_ENABLED ?? 'false';
