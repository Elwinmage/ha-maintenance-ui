/** Fake Home Assistant objects shared by the tests. */

import { vi } from "vitest";
import type { HassLike } from "../src/types";

export function hub_state(
  entity_id: string,
  attrs: Record<string, unknown> = {},
  state = "2026-11-01T00:00:00+01:00",
) {
  return {
    entity_id,
    state,
    attributes: {
      maint_role: "maint_pool_prefilter_clean",
      task_key: "pool_prefilter_clean",
      frequency_unit: "weeks",
      frequency_value: 2,
      anchor: null,
      interval_days: 14,
      days_left: 10,
      overdue: false,
      last_reset: "2026-10-18T10:00:00+02:00",
      notify: true,
      regulatory: false,
      location_id: "loc1",
      location_name: "Maison",
      icon: "mdi:filter-variant",
      friendly_name: "Pompe Nettoyer le pré-filtre",
      ...attrs,
    },
  };
}

type CallService = HassLike["callService"];

export function make_hass(): HassLike & {
  callService: ReturnType<typeof vi.fn<CallService>>;
  states: Record<string, any>;
  entities: Record<string, any>;
  devices: Record<string, any>;
} {
  return {
    language: "fr",
    callService: vi.fn<CallService>(),
    states: {
      "sensor.pompe_prefiltre": hub_state("sensor.pompe_prefiltre"),
      "sensor.pompe_hivernage": hub_state("sensor.pompe_hivernage", {
        maint_role: "maint_pool_winterize",
        task_key: "pool_winterize",
        frequency_unit: "years",
        frequency_value: 1,
        anchor: "10-15",
        interval_days: 365,
        days_left: -3,
        overdue: true,
        icon: "mdi:snowflake",
        friendly_name: "Pompe Hivernage",
      }),
      "sensor.chaudiere_entretien": hub_state("sensor.chaudiere_entretien", {
        maint_role: "maint_boiler_service",
        task_key: "boiler_service",
        frequency_unit: "years",
        frequency_value: 1,
        anchor: "09-01",
        interval_days: 365,
        days_left: 30,
        regulatory: true,
        notify: false,
        location_id: "loc2",
        location_name: "Vacances",
        friendly_name: "Chaudière Entretien annuel",
      }),
      "button.rsdose_clean": {
        state: "unknown",
        attributes: {
          reef_role: "maint_dose_clean",
          task_key: "dose_clean",
          interval_days: 30,
          days_left: null,
          last_reset: null,
          friendly_name: "RSDose4 Head 1 Clean head",
        },
      },
      "switch.rsdose_clean_notify": {
        state: "on",
        attributes: { reef_role: "maint_dose_clean_notify" },
      },
      "number.rsdose_clean_interval": {
        state: "4",
        attributes: {
          reef_role: "maint_dose_clean_interval_weeks",
          min: 1,
          max: 12,
          step: 1,
        },
      },
      "sensor.rsrun_type": { state: "return", attributes: { reef_role: "type" } },
      "sensor.rsrun_model": {
        state: "return-12000",
        attributes: { reef_role: "model" },
      },
      "button.rsrun_clean": {
        state: "unknown",
        attributes: {
          reef_role: "maint_pump_clean",
          task_key: "pump_clean",
          interval_days: 60,
          days_left: 50,
          notify: false,
          friendly_name: "RSRUN pump 1 Clean pump",
        },
      },
      "light.other": { state: "on", attributes: {} },
    },
    entities: {
      "sensor.pompe_prefiltre": { device_id: "pompe" },
      "sensor.pompe_hivernage": { device_id: "pompe" },
      "sensor.chaudiere_entretien": { device_id: "chaudiere" },
      "button.rsdose_clean": { device_id: "head1" },
      "switch.rsdose_clean_notify": { device_id: "head1" },
      "number.rsdose_clean_interval": { device_id: "head1" },
      "sensor.rsrun_type": { device_id: "pump1" },
      "sensor.rsrun_model": { device_id: "pump1" },
      "button.rsrun_clean": { device_id: "pump1" },
    },
    devices: {
      pompe: { name: "Pompe" },
      chaudiere: { name: "Chaudière", name_by_user: null },
      rsdose: { name: "RSDose4" },
      head1: { name: "RSDose4 Head 1", via_device_id: "rsdose" },
      pump1: { name: "RSRUN pump 1" },
    },
  };
}
