/**
 * Hub backend: the `maint_role` contract of maintenance_hub.
 *
 * Each task is a timestamp sensor (state = deadline) carrying every figure
 * as attributes (see ha-maintenance-hub doc/SPEC.md §4). Edits go through
 * the integration services, which never reload the config entry.
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
  HUB_DOMAIN,
  MAINTENANCE_ROLE_PREFIX,
  MAINTENANCE_UNITS,
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

export const HUB_BACKEND_ID = "hub";

/**
 * Tell whether a state object is a maintenance_hub task.
 * @param state: an entry of hass.states
 * @param entity_id: its entity_id when the state does not carry it
 * @return true when the entity exposes the hub contract
 */
export function is_hub_maintenance_state(
  state: any,
  entity_id?: string,
): boolean {
  const attrs = state?.attributes;
  if (!attrs) {
    return false;
  }
  const id = entity_id ?? state?.entity_id;
  if (typeof id === "string" && !id.startsWith("sensor.")) {
    return false;
  }
  const role = attrs.maint_role;
  if (typeof role !== "string" || !role.startsWith(MAINTENANCE_ROLE_PREFIX)) {
    return false;
  }
  return typeof attrs.task_key === "string" && attrs.task_key.length > 0;
}

function as_unit(value: unknown): MaintenanceUnit {
  return (MAINTENANCE_UNITS as readonly string[]).includes(value as string)
    ? (value as MaintenanceUnit)
    : "months";
}

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

  for (const entity_id in hass.states) {
    const state = hass.states[entity_id];
    if (!is_hub_maintenance_state(state, entity_id)) {
      continue;
    }
    const attrs = state.attributes;
    const device_id: string = registry[entity_id]?.device_id || "";
    const device = device_id ? devices[device_id] : undefined;
    if (device?.disabled_by) {
      continue;
    }
    const device_name: string = device?.name_by_user || device?.name || "";
    const root = resolve_root_device(devices, device_id, device_name);

    const interval_days = Math.max(0, to_number(attrs.interval_days, 0));
    const days_left = to_number_or_null(attrs.days_left);
    const overdue = days_left !== null && days_left < 0;
    const friendly = strip_device_prefix(
      String(attrs.friendly_name || ""),
      device_name,
    );
    const anchor =
      typeof attrs.anchor === "string" && attrs.anchor !== ""
        ? attrs.anchor
        : null;
    const location_id =
      typeof attrs.location_id === "string" ? attrs.location_id : "";

    items.push({
      backend: HUB_BACKEND_ID,
      entity_id,
      task_key: String(attrs.task_key),
      role: String(attrs.maint_role),
      notify: attrs.notify !== false,
      can_notify: true,
      frequency: {
        mode: "free",
        unit: as_unit(attrs.frequency_unit),
        value: Math.max(1, Math.round(to_number(attrs.frequency_value, 1))),
        anchor,
      },
      refs: {},
      pump_type: null,
      pump_model: null,
      name: friendly || humanize_task_key(String(attrs.task_key)),
      icon: typeof attrs.icon === "string" ? attrs.icon : null,
      device_id,
      device_name,
      root_device_id: root.id,
      root_device_name: root.name,
      model: device?.model || "",
      location_id,
      location_name:
        typeof attrs.location_name === "string"
          ? attrs.location_name
          : location_id,
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

export const hub_backend: MaintenanceBackend = {
  id: HUB_BACKEND_ID,
  collect,

  reset(hass: HassLike, item: MaintenanceItem): void {
    hass.callService(HUB_DOMAIN, "reset", { entity_id: [item.entity_id] });
  },

  setFrequency(
    hass: HassLike,
    item: MaintenanceItem,
    change: FrequencyChange,
  ): void {
    if (!Number.isFinite(change.value) || change.value < 1) {
      return;
    }
    // An anchor only makes sense with years: drop it otherwise rather than
    // letting the service reject the whole change.
    const anchor = change.unit === "years" ? (change.anchor ?? "") : "";
    hass.callService(HUB_DOMAIN, "set_frequency", {
      entity_id: [item.entity_id],
      unit: change.unit,
      value: Math.round(change.value),
      anchor,
    });
  },

  setNotify(hass: HassLike, item: MaintenanceItem, notify: boolean): void {
    hass.callService(HUB_DOMAIN, "set_notify", {
      entity_id: [item.entity_id],
      notify,
    });
  },
};
