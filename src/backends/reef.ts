/**
 * Reef backend: the `reef_role: maint_*` contract.
 *
 * Used by ha-reefbeat-component, ha-aquamedic-component and reef_maintenance.
 * Each task is a button entity carrying the computed attributes:
 *
 *   reef_role     : "maint_<translation_key>"  -> stable detection marker
 *   task_key      : catalogue key, e.g. "led_lens"
 *   interval_days : configured interval in days
 *   days_left     : remaining days, negative when overdue, null when never reset
 *   last_reset    : ISO-8601 timestamp or null
 *   notify        : mirror of the companion notification switch
 *
 * plus two companion entities: a `switch` (role + "_notify") and a `number`
 * (role + "_interval_<unit>"). Ported from ha-reef-card utils/maintenance.ts.
 */

import type { MaintenanceBackend } from "../backend";
import type {
  FrequencyChange,
  HassLike,
  MaintenanceCollectOptions,
  MaintenanceItem,
  MaintenanceUnit,
} from "../types";
import {
  MAINTENANCE_INTERVAL_INFIX,
  MAINTENANCE_NOTIFY_SUFFIX,
  MAINTENANCE_ROLE_PREFIX,
  MAINTENANCE_WARNING_RATIO,
} from "../constants";
import {
  compute_percent,
  compute_status,
  humanize_task_key,
  resolve_root_device,
  strip_device_prefix,
  to_number,
  to_number_or_null,
} from "../core";

export const REEF_BACKEND_ID = "reef";

/**
 * Tell whether a state object is a reef maintenance task.
 * @param state: an entry of hass.states
 * @param entity_id: its entity_id when the state does not carry it
 * @return true when the entity exposes the maintenance contract
 */
export function is_reef_maintenance_state(
  state: any,
  entity_id?: string,
): boolean {
  const attrs = state?.attributes;
  if (!attrs) {
    return false;
  }
  // The integrations also expose `maint_*` roles on the interval number and
  // the notification switch of each task. The action button is the single
  // source of truth, so restrict the scan to that domain.
  const id = entity_id ?? state?.entity_id;
  if (typeof id === "string" && !id.startsWith("button.")) {
    return false;
  }
  const role = attrs.reef_role;
  if (typeof role !== "string" || !role.startsWith(MAINTENANCE_ROLE_PREFIX)) {
    return false;
  }
  return typeof attrs.task_key === "string" && attrs.task_key.length > 0;
}

/**
 * Index the per-task notification switches by "<device_id>|<button role>".
 */
function index_notify_switches(hass: HassLike): Record<string, string> {
  const index: Record<string, string> = {};
  const registry: Record<string, any> = hass.entities || {};

  for (const entity_id in hass.states) {
    if (!entity_id.startsWith("switch.")) {
      continue;
    }
    const role = hass.states[entity_id]?.attributes?.reef_role;
    if (
      typeof role !== "string" ||
      !role.startsWith(MAINTENANCE_ROLE_PREFIX) ||
      !role.endsWith(MAINTENANCE_NOTIFY_SUFFIX)
    ) {
      continue;
    }
    const base = role.slice(0, -MAINTENANCE_NOTIFY_SUFFIX.length);
    const device_id = registry[entity_id]?.device_id || "";
    index[`${device_id}|${base}`] = entity_id;
  }

  return index;
}

/**
 * Index the RSRUN per-pump descriptors by device_id.
 *
 * Each pump sub-device carries `sensor` entities whose `reef_role` is "type"
 * and "model". Requiring BOTH on the same device is what makes this
 * specific to ReefRun pumps.
 */
function index_pump_details(
  hass: HassLike,
): Record<string, { type: string | null; model: string | null }> {
  const registry: Record<string, any> = hass.entities || {};
  const found: Record<string, { type: string | null; model: string | null }> =
    {};

  for (const entity_id in hass.states) {
    if (!entity_id.startsWith("sensor.")) {
      continue;
    }
    const state = hass.states[entity_id];
    const role = state?.attributes?.reef_role;
    if (role !== "type" && role !== "model") {
      continue;
    }
    const device_id = registry[entity_id]?.device_id;
    if (!device_id) {
      continue;
    }
    const value = state.state;
    if (
      typeof value !== "string" ||
      value === "" ||
      value === "unknown" ||
      value === "unavailable"
    ) {
      continue;
    }
    const entry = (found[device_id] ??= { type: null, model: null });
    if (role === "type") {
      entry.type = value;
    } else {
      entry.model = value;
    }
  }

  const index: Record<string, { type: string | null; model: string | null }> =
    {};
  for (const device_id in found) {
    const entry = found[device_id]!;
    if (entry.type !== null && entry.model !== null) {
      index[device_id] = entry;
    }
  }
  return index;
}

/** Interval number entity resolved for one task. */
interface IntervalRef {
  entity_id: string;
  unit: MaintenanceUnit;
  value: number | null;
  min: number | null;
  max: number | null;
  step: number;
}

/**
 * Index the per-task interval numbers by "<device_id>|<button role>". The
 * number role is the button role with "_interval_<unit>" appended.
 */
function index_interval_numbers(hass: HassLike): Record<string, IntervalRef> {
  const index: Record<string, IntervalRef> = {};
  const registry: Record<string, any> = hass.entities || {};

  for (const entity_id in hass.states) {
    if (!entity_id.startsWith("number.")) {
      continue;
    }
    const state = hass.states[entity_id];
    const role = state?.attributes?.reef_role;
    if (typeof role !== "string" || !role.startsWith(MAINTENANCE_ROLE_PREFIX)) {
      continue;
    }
    const cut = role.lastIndexOf(MAINTENANCE_INTERVAL_INFIX);
    if (cut < 0) {
      continue;
    }
    const unit = role.slice(cut + MAINTENANCE_INTERVAL_INFIX.length);
    if (unit !== "days" && unit !== "weeks" && unit !== "months") {
      continue;
    }
    const attrs = state.attributes;
    const raw = Number(state.state);
    const device_id = registry[entity_id]?.device_id || "";
    const step = Number(attrs.step);

    index[`${device_id}|${role.slice(0, cut)}`] = {
      entity_id,
      unit,
      value: Number.isFinite(raw) ? raw : null,
      min: Number.isFinite(Number(attrs.min)) ? Number(attrs.min) : null,
      max: Number.isFinite(Number(attrs.max)) ? Number(attrs.max) : null,
      step: Number.isFinite(step) && step > 0 ? step : 1,
    };
  }
  return index;
}

/**
 * Scan hass.states and build the reef maintenance items.
 * Entities belonging to a device disabled in Home Assistant are skipped.
 */
function collect(
  hass: HassLike | null,
  options: MaintenanceCollectOptions = {},
): MaintenanceItem[] {
  const items: MaintenanceItem[] = [];
  if (!hass?.states) {
    return items;
  }

  const ratio = options.warning_ratio ?? MAINTENANCE_WARNING_RATIO;
  const registry: Record<string, any> = hass.entities || {};
  const devices: Record<string, any> = hass.devices || {};
  const notify_switches = index_notify_switches(hass);
  const interval_numbers = index_interval_numbers(hass);
  const pump_details = index_pump_details(hass);

  for (const entity_id in hass.states) {
    const state = hass.states[entity_id];
    if (!is_reef_maintenance_state(state, entity_id)) {
      continue;
    }
    const attrs = state.attributes;
    const device_id: string = registry[entity_id]?.device_id || "";
    const device = device_id ? devices[device_id] : undefined;
    if (device?.disabled_by) {
      continue;
    }
    const device_name: string =
      device?.name_by_user || device?.name || attrs.device_name || "";
    const root = resolve_root_device(devices, device_id, device_name);

    const interval_days = Math.max(0, to_number(attrs.interval_days, 0));
    const days_left = to_number_or_null(attrs.days_left);
    const overdue = days_left !== null && days_left < 0;
    const friendly = strip_device_prefix(
      String(attrs.friendly_name || ""),
      device_name,
    );
    const role = String(attrs.reef_role);
    const interval = interval_numbers[`${device_id}|${role}`] ?? null;
    const notify_entity_id = notify_switches[`${device_id}|${role}`] ?? null;
    const pump = device_id ? (pump_details[device_id] ?? null) : null;

    items.push({
      backend: REEF_BACKEND_ID,
      entity_id,
      task_key: String(attrs.task_key),
      role,
      // A missing attribute (older integration) means "notifications on".
      notify: attrs.notify !== false,
      can_notify: notify_entity_id !== null,
      frequency: interval
        ? {
            mode: "slider",
            unit: interval.unit,
            value: interval.value ?? interval.min ?? 1,
            min: interval.min ?? 1,
            max: interval.max ?? 365,
            step: interval.step,
          }
        : null,
      refs: {
        notify_entity_id,
        interval_entity_id: interval?.entity_id ?? null,
      },
      pump_type: pump?.type ?? null,
      pump_model: pump?.model ?? null,
      name: friendly || humanize_task_key(String(attrs.task_key)),
      icon: typeof attrs.icon === "string" ? attrs.icon : null,
      device_id,
      device_name,
      root_device_id: root.id,
      root_device_name: root.name,
      model: device?.model || "",
      location_id: null,
      location_name: null,
      regulatory: attrs.regulatory === true,
      interval_days,
      days_left,
      overdue,
      overdue_days: overdue ? Math.abs(days_left as number) : 0,
      last_reset: typeof attrs.last_reset === "string" ? attrs.last_reset : null,
      percent: compute_percent(days_left, interval_days),
      status: compute_status(days_left, interval_days, ratio),
    });
  }
  return items;
}

export const reef_backend: MaintenanceBackend = {
  id: REEF_BACKEND_ID,
  collect,

  reset(hass: HassLike, item: MaintenanceItem): void {
    hass.callService("button", "press", { entity_id: item.entity_id });
  },

  setFrequency(
    hass: HassLike,
    item: MaintenanceItem,
    change: FrequencyChange,
  ): void {
    const target = item.refs.interval_entity_id;
    const f = item.frequency;
    if (!target || !f || f.mode !== "slider" || !Number.isFinite(change.value)) {
      return;
    }
    // Stay inside the bounds advertised by the number entity; the unit is
    // fixed by the entity.
    const value = Math.min(f.max, Math.max(f.min, change.value));
    hass.callService("number", "set_value", { entity_id: target, value });
  },

  setNotify(hass: HassLike, item: MaintenanceItem, notify: boolean): void {
    const target = item.refs.notify_entity_id;
    if (!target) {
      return;
    }
    hass.callService("switch", notify ? "turn_on" : "turn_off", {
      entity_id: target,
    });
  },
};

/**
 * Tell whether at least one reef maintenance entity is available.
 * @param hass: the hass object
 * @return true when at least one maintenance entity exists
 */
export function has_reef_maintenance_entities(hass: HassLike | null): boolean {
  if (!hass?.states) {
    return false;
  }
  for (const entity_id in hass.states) {
    if (is_reef_maintenance_state(hass.states[entity_id], entity_id)) {
      return true;
    }
  }
  return false;
}
