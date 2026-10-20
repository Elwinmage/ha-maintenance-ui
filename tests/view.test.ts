import { afterEach, describe, expect, it, vi } from "vitest";

import { hub_backend } from "../src/backends/hub";
import { reef_backend } from "../src/backends/reef";
import {
  DEFAULT_VIEW_OPTIONS,
  MaintenanceView,
  define_maintenance_view,
  normalize_view_options,
} from "../src/view";
import type { MaintenanceViewOptions } from "../src/types";
import { make_hass } from "./fixtures";

const TAG = define_maintenance_view("test-maintenance-view");

async function mount(
  options: Partial<MaintenanceViewOptions> = {},
  hass = make_hass(),
  backends = [hub_backend, reef_backend],
) {
  const el = document.createElement(TAG) as MaintenanceView;
  el.hass = hass;
  el.backends = backends;
  el.options = options;
  document.body.appendChild(el);
  await el.updateComplete;
  return { el, hass, root: el.shadowRoot! };
}

async function settle(el: MaintenanceView) {
  await el.updateComplete;
  await el.updateComplete;
}

function texts(root: ShadowRoot, selector: string): string[] {
  return [...root.querySelectorAll(selector)].map((n) =>
    (n.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
}

function row(root: ShadowRoot, name: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>(".maint-entry")].find(
    (entry) => entry.querySelector(".maint-name")!.textContent!.includes(name),
  );
  expect(found, name).toBeDefined();
  return found!;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("normalize_view_options", () => {
  it("keeps valid values and drops the others", () => {
    expect(normalize_view_options(null)).toEqual(DEFAULT_VIEW_OPTIONS);
    const options = normalize_view_options({
      sort: "due",
      devices: ["a", "", 3 as never],
      locations: "x" as never,
      hide_ok: true,
      warning_ratio: 2,
      title: "Entretien",
      default_location: "Bac",
    });
    expect(options.sort).toBe("due");
    expect(options.devices).toEqual(["a"]);
    expect(options.locations).toEqual([]);
    expect(options.hide_ok).toBe(true);
    expect(options.warning_ratio).toBe(0.2);
    expect(options.title).toBe("Entretien");
    expect(options.default_location).toBe("Bac");
    expect(normalize_view_options({ warning_ratio: 0.5 }).warning_ratio).toBe(0.5);
  });
});

describe("maintenance view", () => {
  it("renders locations, devices and counters", async () => {
    const { root } = await mount();
    expect(texts(root, ".maint-title")).toEqual(["Maintenance"]);
    expect(texts(root, ".maint-badge")).toEqual([
      "1 en retard",
      "1 bientôt",
      "1 jamais effectuée",
    ]);
    expect(texts(root, ".maint-location-title")).toEqual([
      "Aquarium",
      "Maison",
      "Vacances",
    ]);
    expect(texts(root, ".maint-group-title")).toEqual([
      "RSDose4 Head 1",
      "RSRUN pump 1 (Retour 12000)",
      "Pompe",
      "Chaudière",
    ]);
    // Regulatory marker and muted row.
    const boiler = row(root, "Entretien annuel");
    expect(boiler.querySelector(".maint-regulatory")).not.toBeNull();
    expect(boiler.querySelector(".maint-row")!.classList.contains("muted")).toBe(true);
    expect(row(root, "Hivernage").querySelector(".maint-remaining")!.textContent).toContain(
      "+3 j",
    );
    expect(row(root, "Clean head").querySelector(".maint-row")!.getAttribute("title")).toContain(
      "RSDose4 Head 1 - Clean head",
    );
  });

  it("keeps the reef look with a single location", async () => {
    const { root } = await mount({ title: "Bac" }, make_hass(), [reef_backend]);
    expect(root.querySelector(".maint-location-title")).toBeNull();
    expect(root.querySelector(".maint-location-select")).toBeNull();
    expect(texts(root, ".maint-title")).toEqual(["Bac"]);
  });

  it("sorts by deadline with device and location subtitles", async () => {
    const { el, root } = await mount();
    root.querySelector<HTMLButtonElement>("#sort-due")!.click();
    await settle(el);
    const names = texts(root, ".maint-name");
    expect(names[0]).toContain("Hivernage - Pompe · Maison");
    expect(root.querySelector(".maint-group-title")).toBeNull();
    root.querySelector<HTMLButtonElement>("#sort-device")!.click();
    await settle(el);
    expect(root.querySelector(".maint-group-title")).not.toBeNull();
  });

  it("uses device subtitles only with a single location", async () => {
    const { el, root } = await mount({ sort: "due", locations: ["loc1"] });
    await settle(el);
    expect(texts(root, ".maint-name")[0]).toContain("Hivernage - Pompe");
    expect(texts(root, ".maint-name")[0]).not.toContain("Maison");
  });

  it("filters from the toolbar", async () => {
    const { el, root } = await mount();
    const location = root.querySelector<HTMLSelectElement>(".maint-location-select")!;
    location.value = "loc1";
    location.dispatchEvent(new Event("change"));
    await settle(el);
    expect(texts(root, ".maint-group-title")).toEqual(["Pompe"]);

    location.value = "";
    location.dispatchEvent(new Event("change"));
    await settle(el);
    const equipment = [
      ...root.querySelectorAll<HTMLSelectElement>(".maint-equip-select"),
    ].at(-1)!;
    equipment.value = "chaudiere";
    equipment.dispatchEvent(new Event("change"));
    await settle(el);
    expect(texts(root, ".maint-group-title")).toEqual(["Chaudière"]);
    equipment.value = "";
    equipment.dispatchEvent(new Event("change"));
    await settle(el);
    expect(texts(root, ".maint-group-title").length).toBe(4);
  });

  it("resets a toolbar filter whose target disappeared", async () => {
    const { el, root } = await mount();
    el["_filter_location"] = "gone";
    el["_filter_device"] = "gone";
    await settle(el);
    expect(el["_filter_location"]).toBeNull();
    expect(el["_filter_device"]).toBeNull();
    expect(texts(root, ".maint-group-title").length).toBe(4);
  });

  it("hides up-to-date and muted tasks", async () => {
    const { el, root } = await mount();
    root.querySelector<HTMLInputElement>("#hide-ok")!.dispatchEvent(new Event("change"));
    await settle(el);
    expect(texts(root, ".maint-name").some((n) => n.includes("pré-filtre"))).toBe(false);
    root.querySelector<HTMLButtonElement>("#hide-muted")!.click();
    await settle(el);
    expect(texts(root, ".maint-name").some((n) => n.includes("Entretien"))).toBe(false);
    expect(root.querySelector("#hide-muted")!.classList.contains("active")).toBe(true);
  });

  it("shows the empty states", async () => {
    const hass = make_hass();
    hass.states = {};
    const { el, root } = await mount({}, hass);
    expect(texts(root, ".maint-empty")).toEqual(["Aucune tâche de maintenance détectée"]);
    el.options = { hide_ok: true };
    await settle(el);
    expect(texts(root, ".maint-empty")).toEqual(["Tout est à jour"]);
  });

  it("renders the all-ok badge and the embedded variant", async () => {
    const hass = make_hass();
    const { root } = await mount({ embedded: true, locations: ["loc1"], devices: [] }, {
      ...hass,
      states: { "sensor.pompe_prefiltre": hass.states["sensor.pompe_prefiltre"] },
    });
    expect(root.querySelector(".maint-title")).toBeNull();
    expect(root.querySelector(".maint-root")!.classList.contains("embedded")).toBe(true);
    expect(texts(root, ".maint-badge")).toEqual(["Tout est à jour"]);
  });

  it("marks done, toggles alerts and opens more-info", async () => {
    const { el, root, hass } = await mount();
    const prefilter = row(root, "pré-filtre");
    prefilter.querySelector<HTMLButtonElement>(".maint-done")!.click();
    expect(hass.callService).toHaveBeenLastCalledWith("maintenance_hub", "reset", {
      entity_id: ["sensor.pompe_prefiltre"],
    });
    prefilter.querySelector<HTMLButtonElement>(".maint-bell")!.click();
    expect(hass.callService).toHaveBeenLastCalledWith("maintenance_hub", "set_notify", {
      entity_id: ["sensor.pompe_prefiltre"],
      notify: false,
    });
    // RSRun pump: no companion switch, so no bell.
    expect(row(root, "Clean pump").querySelector(".maint-bell")).toBeNull();

    const listener = vi.fn();
    el.addEventListener("hass-more-info", listener);
    prefilter.querySelector<HTMLElement>(".maint-body")!.click();
    prefilter
      .querySelector<HTMLElement>(".maint-body")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    prefilter
      .querySelector<HTMLElement>(".maint-body")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0]![0].detail).toEqual({
      entityId: "sensor.pompe_prefiltre",
    });
  });

  it("hides the row buttons when disabled", async () => {
    const { root } = await mount({
      show_reset: false,
      show_notify: false,
      show_interval: false,
    });
    expect(root.querySelector(".maint-done")).toBeNull();
    expect(root.querySelector(".maint-bell")).toBeNull();
    expect(root.querySelector(".maint-tune")).toBeNull();
  });

  it("edits a reef interval with the slider", async () => {
    const { el, root, hass } = await mount();
    const dose = row(root, "Clean head");
    dose.querySelector<HTMLButtonElement>(".maint-tune")!.click();
    await settle(el);
    expect(texts(root, ".maint-editor-value")).toEqual(["4 semaines"]);
    const slider = root.querySelector<HTMLInputElement>(".maint-slider")!;
    slider.value = "6";
    slider.dispatchEvent(new Event("change"));
    expect(hass.callService).toHaveBeenLastCalledWith("number", "set_value", {
      entity_id: "number.rsdose_clean_interval",
      value: 6,
    });
    // Closing the editor.
    row(root, "Clean head").querySelector<HTMLButtonElement>(".maint-tune")!.click();
    await settle(el);
    expect(root.querySelector(".maint-editor")).toBeNull();
  });

  it("edits a hub frequency with the free editor", async () => {
    const { el, root, hass } = await mount();
    row(root, "pré-filtre").querySelector<HTMLButtonElement>(".maint-tune")!.click();
    await settle(el);
    expect(root.querySelector(".maint-seasonal")).toBeNull();

    const value = root.querySelector<HTMLInputElement>(".maint-value")!;
    value.value = "3";
    value.dispatchEvent(new Event("input"));
    const unit = root.querySelector<HTMLSelectElement>(".maint-unit")!;
    unit.value = "years";
    unit.dispatchEvent(new Event("change"));
    await settle(el);

    const seasonal = root.querySelector<HTMLInputElement>(".maint-seasonal")!;
    seasonal.checked = true;
    seasonal.dispatchEvent(new Event("change"));
    await settle(el);
    expect(root.querySelector(".maint-editor-hint")).not.toBeNull();

    const month = root.querySelector<HTMLSelectElement>(".maint-month")!;
    expect(month.options.length).toBe(12);
    month.value = "2";
    month.dispatchEvent(new Event("change"));
    await settle(el);
    const day = root.querySelector<HTMLInputElement>(".maint-day")!;
    day.value = "31";
    day.dispatchEvent(new Event("input"));
    await settle(el);
    expect(root.querySelector<HTMLInputElement>(".maint-day")!.value).toBe("29");

    root.querySelector<HTMLButtonElement>(".maint-apply")!.click();
    expect(hass.callService).toHaveBeenLastCalledWith(
      "maintenance_hub",
      "set_frequency",
      {
        entity_id: ["sensor.pompe_prefiltre"],
        unit: "years",
        value: 3,
        anchor: "02-29",
      },
    );
    await settle(el);
    expect(root.querySelector(".maint-editor")).toBeNull();
  });

  it("opens a seasonal task with its anchor and cancels", async () => {
    const { el, root, hass } = await mount();
    row(root, "Hivernage").querySelector<HTMLButtonElement>(".maint-tune")!.click();
    await settle(el);
    expect(root.querySelector<HTMLInputElement>(".maint-seasonal")!.checked).toBe(true);
    expect(root.querySelector<HTMLSelectElement>(".maint-month")!.value).toBe("10");
    expect(root.querySelector<HTMLInputElement>(".maint-day")!.value).toBe("15");
    // Empty inputs fall back on 1.
    const value = root.querySelector<HTMLInputElement>(".maint-value")!;
    value.value = "";
    value.dispatchEvent(new Event("input"));
    const day = root.querySelector<HTMLInputElement>(".maint-day")!;
    day.value = "";
    day.dispatchEvent(new Event("input"));
    await settle(el);
    expect(root.querySelector<HTMLInputElement>(".maint-day")!.value).toBe("1");
    const calls = hass.callService.mock.calls.length;
    root.querySelector<HTMLButtonElement>(".maint-cancel")!.click();
    await settle(el);
    expect(root.querySelector(".maint-editor")).toBeNull();
    expect(hass.callService.mock.calls.length).toBe(calls);
  });

  it("ignores actions without hass or draft", async () => {
    const { el } = await mount();
    const item = el.collect()[0]!;
    el.hass = null;
    el["_mark_done"](item);
    el["_toggle_notify"](item);
    el["_set_slider"](item, 3);
    el["_apply_draft"](item);
    el["_update_draft"]({ value: 3 });
    expect(el["_render_free_editor"](item).strings.join("")).toBe("");
  });

  it("skips renders when hass changes nothing", async () => {
    const { el } = await mount();
    const render = vi.spyOn(el as never, "render" as never);
    el.hass = { ...el.hass! };
    await settle(el);
    expect(render).not.toHaveBeenCalled();
    const hass = make_hass();
    hass.states["sensor.pompe_prefiltre"].attributes.days_left = 1;
    el.hass = hass;
    await settle(el);
    expect(render).toHaveBeenCalled();
  });

  it("registers a tag once", () => {
    expect(define_maintenance_view("test-maintenance-view")).toBe(TAG);
    expect(define_maintenance_view()).toBe("maintenance-view");
    expect(customElements.get("maintenance-view")).toBeDefined();
  });

  it("falls back on the raw pump type and unknown units", async () => {
    const hass = make_hass();
    hass.states["sensor.rsrun_type"].state = "wavemaker";
    hass.states["sensor.rsrun_model"].state = "custom";
    const { el, root } = await mount({}, hass);
    expect(texts(root, ".maint-group-title")).toContain("RSRUN pump 1 (wavemaker custom)");
    expect(el["_unit_label"](null)).toBe("");
  });
});
