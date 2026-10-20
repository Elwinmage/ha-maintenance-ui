/**
 * Maintenance view types.
 *
 * A "maintenance item" is the card-side projection of one maintenance task,
 * whatever the integration exposing it: the view only ever handles items,
 * and the backends (see backend.ts) turn Home Assistant states into items and
 * user actions into service calls.
 */

/** Minimal shape of the Home Assistant object the view relies on. */
export interface HassLike {
  states: Record<string, any>;
  entities?: Record<string, any>;
  devices?: Record<string, any>;
  language?: string;
  locale?: { language?: string };
  callService: (
    domain: string,
    service: string,
    data?: Record<string, unknown>,
  ) => unknown;
}

/** Lifecycle status of a maintenance task, used to pick a color. */
export type MaintenanceStatus = "never" | "ok" | "warning" | "overdue";

/** Frequency unit. ha-reef-card integrations only use days/weeks/months. */
export type MaintenanceUnit = "days" | "weeks" | "months" | "years";

/** Available sort modes for the maintenance overview. */
export type MaintenanceSort = "device" | "due";

/**
 * How the frequency of a task can be edited.
 *
 * - "slider": bounded interval of a reef number entity (ha-reef-card look)
 * - "free":   unit + value + optional seasonal anchor (maintenance_hub)
 */
export type FrequencyEditor =
  | {
      mode: "slider";
      unit: MaintenanceUnit;
      value: number;
      min: number;
      max: number;
      step: number;
    }
  | {
      mode: "free";
      unit: MaintenanceUnit;
      value: number;
      /** "MM-DD" for a seasonal task, null for a rolling one. */
      anchor: string | null;
    };

/** A frequency change requested by the user. */
export interface FrequencyChange {
  unit: MaintenanceUnit;
  value: number;
  anchor: string | null;
}

export interface MaintenanceItem {
  /** Id of the backend that produced the item ("reef" | "hub"). */
  backend: string;
  /** Home Assistant entity_id of the task entity. */
  entity_id: string;
  /** Stable task identifier coming from the integration catalogue. */
  task_key: string;
  /** Role attribute, e.g. "maint_led_lens". */
  role: string;
  /** False when the user muted the alerts of this task. */
  notify: boolean;
  /** True when the alerts of this task can be toggled. */
  can_notify: boolean;
  /** Frequency editor descriptor, null when the frequency is read-only. */
  frequency: FrequencyEditor | null;
  /** Backend specific handles (companion entities…), opaque to the view. */
  refs: Record<string, string | null>;
  /** RSRUN pump type ("return" / "skimmer"), null for other devices. */
  pump_type: string | null;
  /** RSRUN pump model ("return-12000", "rsk-900"), null for other devices. */
  pump_model: string | null;
  /** Human readable task name (friendly_name without the device prefix). */
  name: string;
  /** MDI icon declared on the entity, if any. */
  icon: string | null;
  /** HA device id owning the entity ("" when the registry entry is missing). */
  device_id: string;
  /** Human readable device name (sub-devices included, e.g. "RSDose4 Head 1"). */
  device_name: string;
  /** HA device id of the root device (top of the `via_device` chain). */
  root_device_id: string;
  /** Human readable name of the root device, e.g. "RSDose4". */
  root_device_name: string;
  /** Device model as declared in the HA device registry. */
  model: string;
  /** Location of the task, null when the backend has no location notion. */
  location_id: string | null;
  location_name: string | null;
  /** True for a regulatory obligation. */
  regulatory: boolean;
  /** Configured interval in days (0 when unknown). */
  interval_days: number;
  /** Remaining days before the deadline, negative when overdue, null when never reset. */
  days_left: number | null;
  /** True when the deadline is passed. */
  overdue: boolean;
  /** Number of days past the deadline (0 when not overdue). */
  overdue_days: number;
  /** ISO-8601 timestamp of the last reset, null when never done. */
  last_reset: string | null;
  /** Elapsed part of the interval, clamped to [0, 100]. */
  percent: number;
  /** Derived status used for coloring. */
  status: MaintenanceStatus;
}

/** A group of maintenance items belonging to the same HA device. */
export interface MaintenanceGroup {
  device_id: string;
  device_name: string;
  pump_type: string | null;
  pump_model: string | null;
  items: MaintenanceItem[];
}

/** A group of device groups belonging to the same location. */
export interface MaintenanceLocationGroup {
  location_id: string | null;
  location_name: string | null;
  groups: MaintenanceGroup[];
}

/** A device offered by the device filters. */
export interface MaintenanceDeviceRef {
  id: string;
  name: string;
  count: number;
  pump_type: string | null;
  pump_model: string | null;
}

/** A location offered by the location filters. */
export interface MaintenanceLocationRef {
  id: string;
  name: string;
  count: number;
}

/** Options accepted by the backends' `collect`. */
export interface MaintenanceCollectOptions {
  /** Fraction of the interval below which a task is "due soon" (0.2). */
  warning_ratio?: number;
}

/** Options of the <maintenance-view> element. */
export interface MaintenanceViewOptions {
  sort: MaintenanceSort;
  /** Device filter (ids or names), empty means every device. */
  devices: string[];
  /** Location filter (ids or names), empty means every location. */
  locations: string[];
  hide_ok: boolean;
  hide_muted: boolean;
  warning_ratio: number;
  show_reset: boolean;
  show_notify: boolean;
  show_interval: boolean;
  /** Header title, empty for the translated "Maintenance". */
  title: string;
  /** Inside a device dialog: no title, own background. */
  embedded: boolean;
  /** Location given to items of backends without locations (reef). */
  default_location: string;
}
