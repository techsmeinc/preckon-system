export const MIN_PASSWORD_LENGTH = 8;

/**
 * The domain a tenant binds to when none is specified (single-domain per tenant;
 * §D.4). Core is domain-neutral — this is only the *fallback* for provisioning and
 * legacy rows, configurable per deployment. It is NOT a construction dependency:
 * any registered pack key is valid, and the registry falls back to the first
 * registered pack if this key isn't present.
 */
export const DEFAULT_DOMAIN_KEY = process.env.PRECKON_DEFAULT_DOMAIN ?? "construction";

/** AI tier ordering, for clamping to an edition's max_tier (§5.5). */
export const TIER_ORDER = ["routing", "standard", "deep"] as const;
export type Tier = (typeof TIER_ORDER)[number];
