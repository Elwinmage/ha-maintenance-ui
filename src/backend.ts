/**
 * Backend contract.
 *
 * A backend knows one family of maintenance entities: how to find them in
 * hass.states and turn them into items, and which services to call when the
 * user marks a task done, edits its frequency or mutes it. The view only
 * talks to backends through this interface, so ha-reef-card and
 * maintenance-hub-card share the very same rendering.
 */

import type {
  FrequencyChange,
  HassLike,
  MaintenanceCollectOptions,
  MaintenanceItem,
} from "./types";

export interface MaintenanceBackend {
  /** Unique id, copied into `MaintenanceItem.backend`. */
  readonly id: string;

  /** Scan hass and build the items of this backend. */
  collect(
    hass: HassLike | null,
    options?: MaintenanceCollectOptions,
  ): MaintenanceItem[];

  /** Mark a task as done now. */
  reset(hass: HassLike, item: MaintenanceItem): void;

  /** Change the frequency of a task. */
  setFrequency(
    hass: HassLike,
    item: MaintenanceItem,
    change: FrequencyChange,
  ): void;

  /** Enable or mute the alerts of a task. */
  setNotify(hass: HassLike, item: MaintenanceItem, notify: boolean): void;
}

/**
 * Collect the items of several backends.
 * @param backends: the backends to query
 * @param hass: the hass object
 * @param options: collection options
 * @return every item, in backend order
 */
export function collect_all(
  backends: MaintenanceBackend[],
  hass: HassLike | null,
  options: MaintenanceCollectOptions = {},
): MaintenanceItem[] {
  return backends.flatMap((backend) => backend.collect(hass, options));
}

/**
 * Find the backend owning an item.
 * @param backends: the known backends
 * @param item: the item
 * @return the backend, or undefined when none matches
 */
export function backend_of(
  backends: MaintenanceBackend[],
  item: MaintenanceItem,
): MaintenanceBackend | undefined {
  return backends.find((backend) => backend.id === item.backend);
}
