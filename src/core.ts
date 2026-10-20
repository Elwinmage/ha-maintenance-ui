/**
 * Pure maintenance helpers: status, progress, sorting, grouping, filtering.
 *
 * Ported from ha-reef-card (utils/maintenance.ts) and extended with the
 * location level. No Lit, no DOM: everything here is unit tested in
 * isolation and shared by every backend.
 */

import type {
  MaintenanceDeviceRef,
  MaintenanceGroup,
  MaintenanceItem,
  MaintenanceLocationGroup,
  MaintenanceLocationRef,
  MaintenanceSort,
  MaintenanceStatus,
} from "./types";
import { MAINTENANCE_WARNING_RATIO } from "./constants";

/**
 * Coerce an unknown attribute into a finite number.
 * @param value: the raw attribute value
 * @param fallback: returned when the value is not a finite number
 * @return the parsed number or the fallback
 */
export function to_number(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Coerce an unknown attribute into a finite number or null.
 * `null`/`undefined`/"unknown" all mean "the task was never reset".
 * @param value: the raw attribute value
 * @return the parsed number, or null when not available
 */
export function to_number_or_null(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn a task_key into a readable fallback label.
 * Example: "run_skim_venturi" -> "Run skim venturi"
 * @param task_key: the catalogue key
 * @return a humanized label
 */
export function humanize_task_key(task_key: string): string {
  const words = String(task_key || "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (words.length === 0) {
    return "";
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Remove the device name Home Assistant prepends to friendly_name when
 * `has_entity_name` is set on the entity.
 * @param friendly_name: the full friendly name, e.g. "ReefLed 160 Clean lenses"
 * @param device_name: the owning device name, e.g. "ReefLed 160"
 * @return the entity-only part, e.g. "Clean lenses"
 */
export function strip_device_prefix(
  friendly_name: string,
  device_name: string,
): string {
  if (!friendly_name) {
    return "";
  }
  if (device_name && friendly_name.startsWith(device_name + " ")) {
    return friendly_name.slice(device_name.length + 1);
  }
  return friendly_name;
}

/**
 * Number of days below which a task is considered "due soon".
 * Always at least one day so that short intervals still get a warning step.
 * @param interval_days: the configured interval
 * @param ratio: the fraction of the interval used as warning window
 * @return the warning threshold in days
 */
export function warning_threshold(
  interval_days: number,
  ratio: number = MAINTENANCE_WARNING_RATIO,
): number {
  if (interval_days <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(interval_days * ratio));
}

/**
 * Derive the display status of a task.
 * @param days_left: remaining days, null when never reset
 * @param interval_days: the configured interval
 * @param ratio: the warning window ratio
 * @return the status used to pick a color
 */
export function compute_status(
  days_left: number | null,
  interval_days: number,
  ratio: number = MAINTENANCE_WARNING_RATIO,
): MaintenanceStatus {
  if (days_left === null) {
    return "never";
  }
  if (days_left < 0) {
    return "overdue";
  }
  if (days_left <= warning_threshold(interval_days, ratio)) {
    return "warning";
  }
  return "ok";
}

/**
 * Elapsed percentage of the interval.
 * @param days_left: remaining days, null when never reset
 * @param interval_days: the configured interval
 * @return a value clamped to [0, 100]; 0 when the task was never reset
 */
export function compute_percent(
  days_left: number | null,
  interval_days: number,
): number {
  if (days_left === null || interval_days <= 0) {
    return 0;
  }
  const elapsed = ((interval_days - days_left) / interval_days) * 100;
  return Math.min(100, Math.max(0, Math.round(elapsed)));
}

/**
 * Walk up the `via_device` chain of a device to find its root.
 * @param devices: the hass.devices registry
 * @param device_id: the id of the device owning the task
 * @param fallback_name: name used when the registry entry is missing
 * @return the id and name of the root device
 */
export function resolve_root_device(
  devices: Record<string, any>,
  device_id: string,
  fallback_name: string,
): { id: string; name: string } {
  let id = device_id;
  const seen = new Set<string>();

  // `seen` guards against a corrupted registry declaring a device cycle.
  while (id && devices[id] && !seen.has(id)) {
    seen.add(id);
    const via = devices[id].via_device_id;
    if (typeof via !== "string" || via === "" || !devices[via]) {
      break;
    }
    id = via;
  }

  const device = id ? devices[id] : undefined;
  const name = device?.name_by_user || device?.name || "";
  return { id: id || "", name: name || fallback_name };
}

/**
 * Give a location to the items of backends that have none (reef tasks), so
 * that the location level stays consistent in the view.
 * @param items: the collected items (modified in place)
 * @param name: the location name to assign
 * @return the same array, for chaining
 */
export function assign_default_location(
  items: MaintenanceItem[],
  name: string,
): MaintenanceItem[] {
  for (const item of items) {
    if (item.location_id === null) {
      item.location_id = `__${item.backend}__`;
      item.location_name = name;
    }
  }
  return items;
}

/**
 * Compare two items by deadline. Never-reset tasks are pushed to the end
 * since they have no computable deadline yet.
 */
function compare_due(a: MaintenanceItem, b: MaintenanceItem): number {
  if (a.days_left === null && b.days_left === null) {
    return 0;
  }
  if (a.days_left === null) {
    return 1;
  }
  if (b.days_left === null) {
    return -1;
  }
  return a.days_left - b.days_left;
}

/** Compare two items by location name, items without location last. */
function compare_location(a: MaintenanceItem, b: MaintenanceItem): number {
  const la = a.location_name ?? "";
  const lb = b.location_name ?? "";
  if (la === lb) {
    return 0;
  }
  if (la === "") {
    return 1;
  }
  if (lb === "") {
    return -1;
  }
  return la.localeCompare(lb);
}

/**
 * Sort maintenance items.
 * @param items: the list to sort (not modified)
 * @param mode: "device" groups by location, equipment then deadline;
 *              "due" sorts globally by deadline
 * @return a new sorted array
 */
export function sort_maintenance_items(
  items: MaintenanceItem[],
  mode: MaintenanceSort,
): MaintenanceItem[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    if (mode === "due") {
      return (
        compare_due(a, b) ||
        a.device_name.localeCompare(b.device_name) ||
        a.name.localeCompare(b.name)
      );
    }
    return (
      compare_location(a, b) ||
      a.device_name.localeCompare(b.device_name) ||
      compare_due(a, b) ||
      a.name.localeCompare(b.name)
    );
  });
  return sorted;
}

/**
 * Group already sorted items by device, preserving the incoming order.
 * @param items: the sorted list of items
 * @return one group per device
 */
export function group_by_device(items: MaintenanceItem[]): MaintenanceGroup[] {
  const groups: MaintenanceGroup[] = [];
  const index: Record<string, MaintenanceGroup> = {};

  for (const item of items) {
    const key = item.device_id || item.device_name;
    let group = index[key];
    if (!group) {
      group = {
        device_id: item.device_id,
        device_name: item.device_name,
        // All items of a group share the same device, so the first one
        // carries the pump details for the whole header.
        pump_type: item.pump_type,
        pump_model: item.pump_model,
        items: [],
      };
      index[key] = group;
      groups.push(group);
    }
    group.items.push(item);
  }

  return groups;
}

/**
 * Group already sorted items by location, then by device.
 * @param items: the sorted list of items
 * @return one group per location, in the incoming order
 */
export function group_by_location(
  items: MaintenanceItem[],
): MaintenanceLocationGroup[] {
  const order: string[] = [];
  const buckets: Record<string, MaintenanceItem[]> = {};
  const names: Record<string, MaintenanceItem> = {};

  for (const item of items) {
    const key = item.location_id ?? "";
    if (!buckets[key]) {
      buckets[key] = [];
      names[key] = item;
      order.push(key);
    }
    buckets[key]!.push(item);
  }

  return order.map((key) => ({
    location_id: names[key]!.location_id,
    location_name: names[key]!.location_name,
    groups: group_by_device(buckets[key]!),
  }));
}

/**
 * List the devices owning at least one maintenance task, one entry per
 * sub-device so the user can filter on individual equipment.
 * @param items: the collected maintenance items
 * @return the devices, sorted by name
 */
export function list_maintenance_devices(
  items: MaintenanceItem[],
): MaintenanceDeviceRef[] {
  const index: Record<string, MaintenanceDeviceRef> = {};
  const list: MaintenanceDeviceRef[] = [];

  for (const item of items) {
    const key = item.device_id || item.device_name;
    let ref = index[key];
    if (!ref) {
      ref = {
        id: item.device_id,
        name: item.device_name,
        count: 0,
        pump_type: item.pump_type,
        pump_model: item.pump_model,
      };
      index[key] = ref;
      list.push(ref);
    }
    ref.count += 1;
  }

  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

/**
 * List the locations owning at least one maintenance task.
 * @param items: the collected maintenance items
 * @return the locations, sorted by name
 */
export function list_maintenance_locations(
  items: MaintenanceItem[],
): MaintenanceLocationRef[] {
  const index: Record<string, MaintenanceLocationRef> = {};
  const list: MaintenanceLocationRef[] = [];

  for (const item of items) {
    if (item.location_id === null) {
      continue;
    }
    let ref = index[item.location_id];
    if (!ref) {
      ref = {
        id: item.location_id,
        name: item.location_name ?? item.location_id,
        count: 0,
      };
      index[item.location_id] = ref;
      list.push(ref);
    }
    ref.count += 1;
  }

  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

/**
 * Keep only the tasks belonging to the selected devices.
 *
 * A selection entry matches a device id or a device name, at the root level
 * as well as at the sub-device level. A root name also matches its
 * sub-devices by prefix, so a hand written "RSDose4" keeps "RSDose4 Head 1".
 * @param items: the collected maintenance items
 * @param selection: the configured device filter, empty means "all devices"
 * @return the filtered list, or the untouched one when no filter is set
 */
export function filter_by_devices(
  items: MaintenanceItem[],
  selection: string[] | null | undefined,
): MaintenanceItem[] {
  if (!Array.isArray(selection)) {
    return items;
  }
  const wanted = selection.filter(
    (name): name is string => typeof name === "string" && name.length > 0,
  );
  if (wanted.length === 0) {
    return items;
  }
  const exact = new Set(wanted);
  return items.filter(
    (item) =>
      exact.has(item.root_device_id) ||
      exact.has(item.root_device_name) ||
      exact.has(item.device_id) ||
      exact.has(item.device_name) ||
      wanted.some((name) => item.device_name.startsWith(name + " ")),
  );
}

/**
 * Keep only the tasks of the selected locations (ids or names).
 * @param items: the collected maintenance items
 * @param selection: the configured location filter, empty means "all"
 * @return the filtered list, or the untouched one when no filter is set
 */
export function filter_by_locations(
  items: MaintenanceItem[],
  selection: string[] | null | undefined,
): MaintenanceItem[] {
  if (!Array.isArray(selection)) {
    return items;
  }
  const wanted = new Set(
    selection.filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    ),
  );
  if (wanted.size === 0) {
    return items;
  }
  return items.filter(
    (item) =>
      (item.location_id !== null && wanted.has(item.location_id)) ||
      (item.location_name !== null && wanted.has(item.location_name)),
  );
}

/**
 * Count items per status, used by the header summary.
 * @param items: the list of items
 * @return the number of items in each status
 */
export function maintenance_counters(items: MaintenanceItem[]): {
  total: number;
  overdue: number;
  warning: number;
  never: number;
} {
  const counters = { total: items.length, overdue: 0, warning: 0, never: 0 };
  for (const item of items) {
    if (item.status === "overdue") {
      counters.overdue += 1;
    } else if (item.status === "warning") {
      counters.warning += 1;
    } else if (item.status === "never") {
      counters.never += 1;
    }
  }
  return counters;
}

/**
 * Build a cheap signature of the maintenance data, used to decide whether a
 * new hass object actually requires a re-render.
 * @param items: the list of items
 * @return a stable string changing only when displayed data changes
 */
export function maintenance_signature(items: MaintenanceItem[]): string {
  return items
    .map((i) => {
      const f = i.frequency;
      const freq = f
        ? `${f.unit}:${f.value}:${f.mode === "free" ? f.anchor : `${f.min}-${f.max}`}`
        : "";
      return `${i.entity_id}|${i.days_left}|${i.interval_days}|${i.device_name}|${i.last_reset}|${i.notify}|${freq}|${i.location_name}|${i.name}`;
    })
    .sort()
    .join(";");
}
