/** Role prefix shared by every maintenance task entity. */
export const MAINTENANCE_ROLE_PREFIX = "maint_";

/** Suffix of the reef notification switch role. */
export const MAINTENANCE_NOTIFY_SUFFIX = "_notify";

/** Infix of the reef interval number role ("maint_x_interval_weeks"). */
export const MAINTENANCE_INTERVAL_INFIX = "_interval_";

/** Last 20% of the interval switches a task to "due soon". */
export const MAINTENANCE_WARNING_RATIO = 0.2;

/** Domain of the maintenance_hub integration. */
export const HUB_DOMAIN = "maintenance_hub";

/** Units, in display order. */
export const MAINTENANCE_UNITS = ["days", "weeks", "months", "years"] as const;
