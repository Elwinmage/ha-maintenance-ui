import { describe, expect, it } from "vitest";

import {
  has_reef_maintenance_entities,
  is_reef_maintenance_state,
  reef_backend,
} from "../src/backends/reef";
import { hub_backend, is_hub_maintenance_state } from "../src/backends/hub";
import { make_hass } from "./fixtures";

describe("reef backend", () => {
  it("collects buttons with their companions", () => {
    const hass = make_hass();
    const all = reef_backend.collect(hass, { warning_ratio: 0.5 });
    expect(all.map((i) => i.entity_id).sort()).toEqual([
      "button.rsdose_clean",
      "button.rsrun_clean",
    ]);
    const dose = all.find((i) => i.task_key === "dose_clean")!;
    expect(dose.name).toBe("Clean head");
    expect(dose.status).toBe("never");
    expect(dose.root_device_name).toBe("RSDose4");
    expect(dose.can_notify).toBe(true);
    expect(dose.frequency).toEqual({
      mode: "slider",
      unit: "weeks",
      value: 4,
      min: 1,
      max: 12,
      step: 1,
    });
    const pump = all.find((i) => i.task_key === "pump_clean")!;
    expect(pump.notify).toBe(false);
    expect(pump.can_notify).toBe(false);
    expect(pump.frequency).toBeNull();
    expect(pump.pump_type).toBe("return");
    expect(pump.pump_model).toBe("return-12000");
    expect(pump.location_id).toBeNull();
  });

  it("skips disabled devices and odd entities", () => {
    const hass = make_hass();
    hass.devices!.head1.disabled_by = "user";
    // Broken companions are ignored.
    hass.states["number.bad"] = {
      state: "x",
      attributes: { reef_role: "maint_pump_clean_interval_hours" },
    };
    hass.states["number.noinfix"] = {
      state: "1",
      attributes: { reef_role: "maint_pump_clean" },
    };
    hass.states["number.other"] = { state: "1", attributes: {} };
    hass.states["switch.other"] = { state: "on", attributes: {} };
    hass.states["sensor.typeless"] = {
      state: "unknown",
      attributes: { reef_role: "type" },
    };
    hass.states["sensor.orphan"] = {
      state: "return",
      attributes: { reef_role: "type" },
    };
    hass.entities!["sensor.typeless"] = { device_id: "pump2" };
    hass.states["button.unnamed"] = {
      state: "unknown",
      attributes: {
        reef_role: "maint_glass_clean",
        task_key: "glass_clean",
        days_left: "3",
        interval_days: "10",
        last_reset: "2026-10-10T00:00:00Z",
        icon: "mdi:glass",
      },
    };
    hass.states["number.interval_nan"] = {
      state: "n/a",
      attributes: { reef_role: "maint_glass_clean_interval_days", step: 0 },
    };
    const all = reef_backend.collect(hass);
    expect(all.map((i) => i.task_key).sort()).toEqual([
      "glass_clean",
      "pump_clean",
    ]);
    const glass = all.find((i) => i.task_key === "glass_clean")!;
    expect(glass.name).toBe("Glass clean");
    expect(glass.icon).toBe("mdi:glass");
    expect(glass.device_id).toBe("");
    expect(glass.frequency).toEqual({
      mode: "slider",
      unit: "days",
      value: 1,
      min: 1,
      max: 365,
      step: 1,
    });
    expect(reef_backend.collect(null)).toEqual([]);
  });

  it("detects reef entities", () => {
    expect(is_reef_maintenance_state(null)).toBe(false);
    expect(
      is_reef_maintenance_state({
        entity_id: "sensor.x",
        attributes: { reef_role: "maint_a", task_key: "a" },
      }),
    ).toBe(false);
    expect(
      is_reef_maintenance_state({ attributes: { reef_role: "maint_a" } }),
    ).toBe(false);
    expect(has_reef_maintenance_entities(make_hass())).toBe(true);
    expect(has_reef_maintenance_entities(null)).toBe(false);
    const hass = make_hass();
    hass.states = {};
    expect(has_reef_maintenance_entities(hass)).toBe(false);
  });

  it("calls the reef services", () => {
    const hass = make_hass();
    const [dose, pump] = reef_backend
      .collect(hass)
      .sort((a, b) => a.task_key.localeCompare(b.task_key));
    reef_backend.reset(hass, dose!);
    expect(hass.callService).toHaveBeenLastCalledWith("button", "press", {
      entity_id: "button.rsdose_clean",
    });
    reef_backend.setFrequency(hass, dose!, { unit: "weeks", value: 50, anchor: null });
    expect(hass.callService).toHaveBeenLastCalledWith("number", "set_value", {
      entity_id: "number.rsdose_clean_interval",
      value: 12,
    });
    reef_backend.setNotify(hass, dose!, false);
    expect(hass.callService).toHaveBeenLastCalledWith("switch", "turn_off", {
      entity_id: "switch.rsdose_clean_notify",
    });
    reef_backend.setNotify(hass, dose!, true);
    expect(hass.callService).toHaveBeenLastCalledWith("switch", "turn_on", {
      entity_id: "switch.rsdose_clean_notify",
    });
    const calls = hass.callService.mock.calls.length;
    reef_backend.setFrequency(hass, pump!, { unit: "weeks", value: 2, anchor: null });
    reef_backend.setFrequency(hass, dose!, { unit: "weeks", value: NaN, anchor: null });
    reef_backend.setNotify(hass, pump!, true);
    expect(hass.callService.mock.calls.length).toBe(calls);
  });
});

describe("hub backend", () => {
  it("collects sensors", () => {
    const hass = make_hass();
    const all = hub_backend.collect(hass);
    expect(all.length).toBe(3);
    const winter = all.find((i) => i.task_key === "pool_winterize")!;
    expect(winter.name).toBe("Hivernage");
    expect(winter.status).toBe("overdue");
    expect(winter.overdue_days).toBe(3);
    expect(winter.frequency).toEqual({
      mode: "free",
      unit: "years",
      value: 1,
      anchor: "10-15",
    });
    const boiler = all.find((i) => i.task_key === "boiler_service")!;
    expect(boiler.regulatory).toBe(true);
    expect(boiler.notify).toBe(false);
    expect(boiler.location_name).toBe("Vacances");
  });

  it("tolerates odd attributes", () => {
    const hass = make_hass();
    hass.devices!.chaudiere.disabled_by = "user";
    hass.states["sensor.odd"] = {
      state: "unknown",
      attributes: {
        maint_role: "maint_custom_x",
        task_key: "custom_x",
        frequency_unit: "fortnights",
        frequency_value: "x",
        anchor: "",
        location_id: "loc3",
      },
    };
    const odd = hub_backend.collect(hass).find((i) => i.task_key === "custom_x")!;
    expect(odd.frequency).toEqual({ mode: "free", unit: "months", value: 1, anchor: null });
    expect(odd.location_name).toBe("loc3");
    expect(odd.name).toBe("Custom x");
    expect(odd.icon).toBeNull();
    expect(odd.last_reset).toBeNull();
    expect(hub_backend.collect(hass).some((i) => i.task_key === "boiler_service")).toBe(
      false,
    );
    hass.states["sensor.nolocation"] = {
      state: "unknown",
      attributes: { maint_role: "maint_y", task_key: "y" },
    };
    expect(
      hub_backend.collect(hass).find((i) => i.task_key === "y")!.location_id,
    ).toBe("");
    expect(hub_backend.collect(null)).toEqual([]);
  });

  it("detects hub entities", () => {
    expect(is_hub_maintenance_state(undefined)).toBe(false);
    expect(
      is_hub_maintenance_state({
        entity_id: "button.x",
        attributes: { maint_role: "maint_a", task_key: "a" },
      }),
    ).toBe(false);
    expect(is_hub_maintenance_state({ attributes: { maint_role: 3 } })).toBe(false);
    expect(
      is_hub_maintenance_state({ attributes: { maint_role: "maint_a", task_key: "" } }),
    ).toBe(false);
  });

  it("calls the hub services", () => {
    const hass = make_hass();
    const item = hub_backend.collect(hass)[0]!;
    hub_backend.reset(hass, item);
    expect(hass.callService).toHaveBeenLastCalledWith("maintenance_hub", "reset", {
      entity_id: [item.entity_id],
    });
    hub_backend.setFrequency(hass, item, { unit: "years", value: 1.4, anchor: "04-01" });
    expect(hass.callService).toHaveBeenLastCalledWith(
      "maintenance_hub",
      "set_frequency",
      { entity_id: [item.entity_id], unit: "years", value: 1, anchor: "04-01" },
    );
    hub_backend.setFrequency(hass, item, { unit: "years", value: 2, anchor: null });
    expect(hass.callService.mock.lastCall![2]!.anchor).toBe("");
    hub_backend.setFrequency(hass, item, { unit: "months", value: 3, anchor: "04-01" });
    expect(hass.callService.mock.lastCall![2]!.anchor).toBe("");
    const calls = hass.callService.mock.calls.length;
    hub_backend.setFrequency(hass, item, { unit: "months", value: 0, anchor: null });
    expect(hass.callService.mock.calls.length).toBe(calls);
    hub_backend.setNotify(hass, item, false);
    expect(hass.callService).toHaveBeenLastCalledWith("maintenance_hub", "set_notify", {
      entity_id: [item.entity_id],
      notify: false,
    });
  });
});
