/**
 * Limits shared by the client and the API routes.
 *
 * The composer's `maxLength` has to mirror a real server-side bound, or it is
 * decoration: the authenticated route accepted a message of any length, so an
 * over-long question failed somewhere downstream instead of being refused
 * up front (issue #2, P1).
 */

/** Longest question accepted from a signed-in user. */
export const MAX_MESSAGE_LEN = 2_000;

/** Longest question accepted on the public demo, which is shared and rate-limited. */
export const MAX_DEMO_MESSAGE_LEN = 500;
