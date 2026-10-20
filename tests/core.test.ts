import { describe, expect, it } from "vitest";

import {
  assign_default_location,
  compute_percent,
  compute_status,
  filter_by_devices,
  filter_by_locations,
  group_by_location,
  humanize_task_key,
  list_maintenance_devices,
  list_maintenance_locations,
  maintenance_counters,
  maintenance_signature,
  resolve_root_device,
  sort_maintenance_items,
  strip_device_prefix,
  to_number,
  to_number_or_null,
  warning_threshold,
} from "../src/core";
import { backend_of, collect_all } from "../src/backend";
import { hub_backend } from "../src/backends/hub";
import { reef_backend } from "../src/backends/reef";
import { has_translation, language_of, t } from "../src/i18n";
import { make_hass } from "./fixtures";

function items() {
  const hass = make_hass();
  return assign_default_location(
    collect_all([hub_backend, reef_backend], hass),
    "Aquarium",
  );
}

describe("number helpers", () => {
  it("coerces attributes", () => {
    expect(to_number("12", 0)).toBe(12);
    expect(to_number(null, 5)).toBe(5);
    expect(to_number("x", 5)).toBe(5);
    expect(to_number_or_null("")).toBeNull();
    expect(to_number_or_null("unknown")).toBeNull();
    expect(to_number_or_null("-3")).toBe(-3);
  });
});

describe("labels", () => {
  it("humanizes keys and strips device prefixes", () => {
    expect(humanize_task_key("run_skim_venturi")).toBe("Run skim venturi");
    expect(humanize_task_key("")).toBe("");
    expect(strip_device_prefix("Pompe Nettoyer", "Pompe")).toBe("Nettoyer");
    expect(strip_device_prefix("Autre", "Pompe")).toBe("Autre");
    expect(strip_device_prefix("", "Pompe")).toBe("");
  });
});

describe("status", () => {
  it("computes thresholds, status and percent", () => {
    expect(warning_threshold(0)).toBe(0);
    expect(warning_threshold(3)).toBe(1);
    expect(warning_threshold(100)).toBe(20);
    expect(compute_status(null, 10)).toBe("never");
    expect(compute_status(-1, 10)).toBe("overdue");
    expect(compute_status(2, 10)).toBe("warning");
    expect(compute_status(5, 10)).toBe("ok");
    expect(compute_percent(null, 10)).toBe(0);
    expect(compute_percent(5, 0)).toBe(0);
    expect(compute_percent(5, 10)).toBe(50);
    expect(compute_percent(-5, 10)).toBe(100);
  });
});

describe("resolve_root_device", () => {
  it("walks via_device and survives cycles", () => {
    const devices = {
      a: { name: "A", via_device_id: "b" },
      b: { name: "B", via_device_id: "a" },
      c: { name: "", via_device_id: "missing" },
    };
    expect(["a", "b"]).toContain(resolve_root_device(devices, "a", "x").id);
    expect(resolve_root_device(devices, "c", "fallback")).toEqual({
      id: "c",
      name: "fallback",
    });
    expect(resolve_root_device({}, "", "fallback")).toEqual({
      id: "",
      name: "fallback",
    });
  });
});

describe("collections", () => {
  it("assigns locations to reef items only", () => {
    const all = items();
    const reef = all.filter((i) => i.backend === "reef");
    expect(reef.every((i) => i.location_name === "Aquarium")).toBe(true);
    expect(all.find((i) => i.task_key === "boiler_service")!.location_name).toBe(
      "Vacances",
    );
  });

  it("sorts by location then device in device mode", () => {
    const sorted = sort_maintenance_items(items(), "device");
    expect(sorted.map((i) => i.location_name)).toEqual([
      "Aquarium",
      "Aquarium",
      "Maison",
      "Maison",
      "Vacances",
    ]);
    // Inside Maison: overdue first.
    expect(sorted[2]!.task_key).toBe("pool_winterize");
  });

  it("sorts by deadline in due mode, never-done last", () => {
    const sorted = sort_maintenance_items(items(), "due");
    expect(sorted[0]!.task_key).toBe("pool_winterize");
    expect(sorted.at(-1)!.task_key).toBe("dose_clean");
  });

  it("puts items without location last", () => {
    const list = items();
    list[0]!.location_name = null;
    const sorted = sort_maintenance_items(list, "device");
    expect(sorted.at(-1)!.location_name).toBeNull();
    list[1]!.location_name = null;
    expect(sort_maintenance_items(list, "device").at(-1)!.location_name).toBeNull();
  });

  it("groups by location then device", () => {
    const groups = group_by_location(sort_maintenance_items(items(), "device"));
    expect(groups.map((g) => g.location_name)).toEqual([
      "Aquarium",
      "Maison",
      "Vacances",
    ]);
    expect(groups[0]!.groups.map((g) => g.device_name)).toEqual([
      "RSDose4 Head 1",
      "RSRUN pump 1",
    ]);
    expect(group_by_location([{ ...items()[0]!, location_id: null }])[0]!
      .location_id).toBeNull();
  });

  it("lists devices and locations", () => {
    const all = items();
    expect(list_maintenance_devices(all).map((d) => [d.name, d.count])).toEqual([
      ["Chaudière", 1],
      ["Pompe", 2],
      ["RSDose4 Head 1", 1],
      ["RSRUN pump 1", 1],
    ]);
    const locations = list_maintenance_locations([
      ...all,
      { ...all[0]!, location_id: null },
    ]);
    expect(locations.map((l) => [l.name, l.count])).toEqual([
      ["Aquarium", 2],
      ["Maison", 2],
      ["Vacances", 1],
    ]);
    expect(
      list_maintenance_locations([{ ...all[0]!, location_name: null }])[0]!.name,
    ).toBe(all[0]!.location_id);
  });

  it("filters by devices", () => {
    const all = items();
    expect(filter_by_devices(all, null)).toBe(all);
    expect(filter_by_devices(all, [])).toBe(all);
    expect(filter_by_devices(all, ["rsdose"]).map((i) => i.task_key)).toEqual([
      "dose_clean",
    ]);
    expect(filter_by_devices(all, ["RSDose4"]).length).toBe(1);
    expect(filter_by_devices(all, ["Pompe"]).length).toBe(2);
  });

  it("filters by locations", () => {
    const all = items();
    expect(filter_by_locations(all, undefined)).toBe(all);
    expect(filter_by_locations(all, [""])).toBe(all);
    expect(filter_by_locations(all, ["loc2"]).length).toBe(1);
    expect(filter_by_locations(all, ["Maison"]).length).toBe(2);
    expect(
      filter_by_locations(
        [{ ...all[0]!, location_id: null, location_name: null }],
        ["x"],
      ),
    ).toEqual([]);
  });

  it("counts and signs", () => {
    const all = items();
    expect(maintenance_counters(all)).toEqual({
      total: 5,
      overdue: 1,
      warning: 1,
      never: 1,
    });
    const before = maintenance_signature(all);
    all[0]!.days_left = 99;
    expect(maintenance_signature(all)).not.toBe(before);
    all[0]!.frequency = null;
    expect(maintenance_signature(all)).toContain("||");
  });
});

describe("backend helpers", () => {
  it("finds the backend of an item", () => {
    const all = items();
    expect(backend_of([hub_backend, reef_backend], all[0]!)).toBe(hub_backend);
    expect(backend_of([], all[0]!)).toBeUndefined();
    expect(collect_all([hub_backend], null)).toEqual([]);
  });
});

describe("i18n", () => {
  it("picks languages and falls back", () => {
    expect(language_of(null)).toBe("en");
    expect(language_of({ locale: { language: "fr-CA" } } as never)).toBe("fr");
    expect(language_of({ language: "ja" } as never)).toBe("en");
    expect(t("maintenance_view", "fr")).toBe("Maintenance");
    expect(t("unit_years", "de")).toBe("Jahre");
    expect(t("nope", "fr")).toBe("nope");
    expect(t("unit_years", "xx")).toBe("years");
    expect(has_translation("pump_type_return", "fr")).toBe(true);
    expect(has_translation("pump_type_foo", "fr")).toBe(false);
    expect(has_translation("unit_days", "xx")).toBe(true);
  });
});
