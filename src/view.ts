/**
 * Maintenance overview element.
 *
 * Same rendering as the ha-reef-card maintenance view:
 *
 *   - one progress bar per task showing how much of the interval elapsed,
 *   - a color change (green / orange / red) driven by the remaining days,
 *     with a "+X days" label once the deadline is passed,
 *   - sorting by equipment or by deadline, equipment quick filter,
 *   - "mark as done", alert bell and inline frequency editor per row,
 *
 * plus a location level above the device groups when tasks come from more
 * than one location, a regulatory marker, and a free frequency editor
 * (unit + value + seasonal date) for backends that support it.
 *
 * The element knows nothing about entities: items come from the backends,
 * and every action goes back through them.
 *
 * Each bundle registers the class under its own tag (see
 * `define_maintenance_view`), so two cards shipping different versions of
 * this module never fight over a single custom element name.
 */

import { LitElement, html, type PropertyValues, type TemplateResult } from "lit";

import type { MaintenanceBackend } from "./backend";
import { backend_of, collect_all } from "./backend";
import {
  assign_default_location,
  filter_by_devices,
  filter_by_locations,
  group_by_device,
  group_by_location,
  list_maintenance_devices,
  list_maintenance_locations,
  maintenance_counters,
  maintenance_signature,
  sort_maintenance_items,
} from "./core";
import { has_translation, language_of, t } from "./i18n";
import maintenance_styles from "./styles";
import { MAINTENANCE_UNITS, MAINTENANCE_WARNING_RATIO } from "./constants";
import type {
  HassLike,
  MaintenanceGroup,
  MaintenanceItem,
  MaintenanceSort,
  MaintenanceUnit,
  MaintenanceViewOptions,
} from "./types";

export const DEFAULT_VIEW_OPTIONS: MaintenanceViewOptions = {
  sort: "device",
  devices: [],
  locations: [],
  hide_ok: false,
  // Muted tasks stay visible by default: silencing an alert should not
  // make the deadline disappear from the overview.
  hide_muted: false,
  warning_ratio: MAINTENANCE_WARNING_RATIO,
  show_reset: true,
  show_notify: true,
  show_interval: true,
  title: "",
  embedded: false,
  default_location: "",
};

/** Draft of the free frequency editor. */
interface FrequencyDraft {
  unit: MaintenanceUnit;
  value: number;
  seasonal: boolean;
  month: number;
  day: number;
}

/**
 * Days in a month of a leap year, so Feb 29 stays selectable.
 * @param month: 1-12
 * @return the number of days
 */
function month_length(month: number): number {
  return new Date(2000, month, 0).getDate();
}

/**
 * Merge user options with the defaults, dropping invalid values.
 * @param raw: user options (card config)
 * @return complete, valid options
 */
export function normalize_view_options(
  raw: Partial<MaintenanceViewOptions> | null | undefined,
): MaintenanceViewOptions {
  const user = raw ?? {};
  const bool = (key: keyof MaintenanceViewOptions): boolean =>
    typeof user[key] === "boolean"
      ? (user[key] as boolean)
      : (DEFAULT_VIEW_OPTIONS[key] as boolean);
  const list = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter(
          (v: unknown): v is string => typeof v === "string" && v.length > 0,
        )
      : [];
  const ratio = Number(user.warning_ratio);
  return {
    sort: user.sort === "due" || user.sort === "device" ? user.sort : "device",
    devices: list(user.devices),
    locations: list(user.locations),
    hide_ok: bool("hide_ok"),
    hide_muted: bool("hide_muted"),
    warning_ratio:
      Number.isFinite(ratio) && ratio > 0 && ratio < 1
        ? ratio
        : DEFAULT_VIEW_OPTIONS.warning_ratio,
    show_reset: bool("show_reset"),
    show_notify: bool("show_notify"),
    show_interval: bool("show_interval"),
    title: typeof user.title === "string" ? user.title : "",
    embedded: bool("embedded"),
    default_location:
      typeof user.default_location === "string" ? user.default_location : "",
  };
}

export class MaintenanceView extends LitElement {
  static override styles = [maintenance_styles];

  static override properties = {
    hass: { attribute: false },
    backends: { attribute: false },
    options: { attribute: false },
    _sort: { state: true },
    _hide_ok: { state: true },
    _hide_muted: { state: true },
    _filter_device: { state: true },
    _filter_location: { state: true },
    _editing: { state: true },
    _draft: { state: true },
  };

  declare hass: HassLike | null;
  declare backends: MaintenanceBackend[];
  declare options: Partial<MaintenanceViewOptions>;

  declare _sort: MaintenanceSort;
  declare _hide_ok: boolean;
  declare _hide_muted: boolean;
  // Runtime filters from the toolbar dropdowns; null means "all".
  declare _filter_device: string | null;
  declare _filter_location: string | null;
  // entity_id of the task whose frequency editor is expanded.
  declare _editing: string | null;
  declare _draft: FrequencyDraft | null;

  // Signature of the last rendered data set, used to skip useless renders.
  private _signature: string | null = null;

  constructor() {
    super();
    this.hass = null;
    this.backends = [];
    this.options = {};
    this._sort = DEFAULT_VIEW_OPTIONS.sort;
    this._hide_ok = DEFAULT_VIEW_OPTIONS.hide_ok;
    this._hide_muted = DEFAULT_VIEW_OPTIONS.hide_muted;
    this._filter_device = null;
    this._filter_location = null;
    this._editing = null;
    this._draft = null;
  }

  // ---- data ----------------------------------------------------------------

  /** Effective options. */
  get view_options(): MaintenanceViewOptions {
    return normalize_view_options(this.options);
  }

  /** Language of the dictionaries. */
  private get _lang(): string {
    return language_of(this.hass);
  }

  private _t(key: string): string {
    return t(key, this._lang);
  }

  /**
   * Every item the configured filters let through (before the toolbar
   * filters), locations assigned.
   * @param options: the effective view options
   */
  collect(options: MaintenanceViewOptions = this.view_options): MaintenanceItem[] {
    const items = assign_default_location(
      collect_all(this.backends, this.hass, {
        warning_ratio: options.warning_ratio,
      }),
      options.default_location || this._t("maintenance_reef_location"),
    );
    return filter_by_devices(
      filter_by_locations(items, options.locations),
      options.devices,
    );
  }

  /**
   * Skip renders triggered by a hass update that changed nothing in the
   * maintenance data: the card receives a new hass on every state change of
   * the whole installation.
   */
  protected override shouldUpdate(changed: PropertyValues): boolean {
    if (changed.size === 1 && changed.has("hass")) {
      const signature = maintenance_signature(this.collect());
      if (signature === this._signature) {
        return false;
      }
    }
    return true;
  }

  /** Apply the configured defaults whenever the configuration changes. */
  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("options")) {
      const options = this.view_options;
      this._sort = options.sort;
      this._hide_ok = options.hide_ok;
      this._hide_muted = options.hide_muted;
    }
  }

  // ---- actions ---------------------------------------------------------------

  private _backend(item: MaintenanceItem): MaintenanceBackend | undefined {
    return backend_of(this.backends, item);
  }

  /** Open the Home Assistant more-info dialog of a task. */
  private _more_info(item: MaintenanceItem): void {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId: item.entity_id },
      }),
    );
  }

  private _mark_done(item: MaintenanceItem): void {
    if (this.hass) {
      this._backend(item)?.reset(this.hass, item);
    }
  }

  private _toggle_notify(item: MaintenanceItem): void {
    if (this.hass && item.can_notify) {
      this._backend(item)?.setNotify(this.hass, item, !item.notify);
    }
  }

  /**
   * Expand/collapse the frequency editor of a task. Only one row at a time
   * stays open, so the list does not turn into a wall of editors.
   */
  private _toggle_editor(item: MaintenanceItem): void {
    if (this._editing === item.entity_id) {
      this._editing = null;
      this._draft = null;
      return;
    }
    this._editing = item.entity_id;
    const f = item.frequency;
    if (f?.mode === "free") {
      const [month, day] = (f.anchor ?? "").split("-").map(Number);
      this._draft = {
        unit: f.unit,
        value: f.value,
        seasonal: f.anchor !== null,
        month: month || 1,
        day: day || 1,
      };
    } else {
      this._draft = null;
    }
  }

  /** Write a new interval through the slider (reef look). */
  private _set_slider(item: MaintenanceItem, value: number): void {
    const f = item.frequency;
    if (!this.hass || f?.mode !== "slider" || !Number.isFinite(value)) {
      return;
    }
    this._backend(item)?.setFrequency(this.hass, item, {
      unit: f.unit,
      value,
      anchor: null,
    });
  }

  private _update_draft(changes: Partial<FrequencyDraft>): void {
    if (!this._draft) {
      return;
    }
    const next = { ...this._draft, ...changes };
    next.day = Math.min(Math.max(1, next.day), month_length(next.month));
    this._draft = next;
  }

  /** Apply the free editor draft. */
  private _apply_draft(item: MaintenanceItem): void {
    const draft = this._draft;
    if (!this.hass || !draft) {
      return;
    }
    const value = Math.min(999, Math.max(1, Math.round(draft.value)));
    const seasonal = draft.seasonal && draft.unit === "years";
    const anchor = seasonal
      ? `${String(draft.month).padStart(2, "0")}-${String(draft.day).padStart(2, "0")}`
      : null;
    this._backend(item)?.setFrequency(this.hass, item, {
      unit: draft.unit,
      value,
      anchor,
    });
    this._editing = null;
    this._draft = null;
  }

  // ---- labels ----------------------------------------------------------------

  /**
   * Parenthesised pump descriptor appended to a ReefRun sub-device name,
   * e.g. "RSRUN-1234 pump 1" -> " (Retour 12000)".
   */
  private _pump_suffix(type: string | null, model: string | null): string {
    const parts: string[] = [];
    if (type) {
      const key = `pump_type_${type}`;
      parts.push(has_translation(key, this._lang) ? this._t(key) : type);
    }
    if (model) {
      const figure = model.match(/(\d+)\s*$/);
      parts.push(figure ? figure[1]! : model);
    }
    return parts.length > 0 ? ` (${parts.join(" ")})` : "";
  }

  private _device_label(
    name: string,
    type: string | null,
    model: string | null,
  ): string {
    return `${name}${this._pump_suffix(type, model)}`;
  }

  private _unit_label(unit: string | null): string {
    return unit ? this._t(`unit_${unit}`) : "";
  }

  private _remaining_label(item: MaintenanceItem): string {
    if (item.days_left === null) {
      return this._t("maintenance_never_done");
    }
    if (item.days_left < 0) {
      return `+${item.overdue_days} ${this._t("days_short")}`;
    }
    if (item.days_left === 0) {
      return this._t("maintenance_today");
    }
    return `${item.days_left} ${this._t("days_short")}`;
  }

  /** Native tooltip of a row. */
  private _row_title(item: MaintenanceItem): string {
    const device = this._device_label(
      item.device_name,
      item.pump_type,
      item.pump_model,
    );
    const parts: string[] = [`${device} - ${item.name}`];
    if (item.regulatory) {
      parts.push(this._t("maintenance_regulatory"));
    }
    if (item.interval_days > 0) {
      parts.push(
        `${this._t("maintenance_interval")}: ${item.interval_days} ${this._t("days_short")}`,
      );
    }
    if (item.last_reset) {
      const date = new Date(item.last_reset);
      if (!Number.isNaN(date.getTime())) {
        parts.push(
          `${this._t("maintenance_last_reset")}: ${date.toLocaleDateString()}`,
        );
      }
    }
    if (item.days_left !== null) {
      const next = new Date();
      next.setDate(next.getDate() + item.days_left);
      parts.push(`${this._t("maintenance_next_on")}: ${next.toLocaleDateString()}`);
    }
    return parts.join("\n");
  }

  private _month_names(): string[] {
    const format = new Intl.DateTimeFormat(this._lang, { month: "long" });
    return Array.from({ length: 12 }, (_, i) =>
      format.format(new Date(2000, i, 1)),
    );
  }

  // ---- render ----------------------------------------------------------------

  private _render_counters(items: MaintenanceItem[]): TemplateResult {
    const counters = maintenance_counters(items);
    const badges: TemplateResult[] = [];

    if (counters.overdue > 0) {
      badges.push(
        html`<span class="maint-badge overdue"
          >${counters.overdue} ${this._t("maintenance_overdue")}</span
        >`,
      );
    }
    if (counters.warning > 0) {
      badges.push(
        html`<span class="maint-badge warning"
          >${counters.warning} ${this._t("maintenance_due_soon")}</span
        >`,
      );
    }
    if (counters.never > 0) {
      badges.push(
        html`<span class="maint-badge never"
          >${counters.never} ${this._t("maintenance_never_done")}</span
        >`,
      );
    }
    if (badges.length === 0 && counters.total > 0) {
      badges.push(
        html`<span class="maint-badge ok"
          >${this._t("maintenance_all_ok")}</span
        >`,
      );
    }
    return html`<div class="maint-counters">${badges}</div>`;
  }

  private _render_location_filter(items: MaintenanceItem[]): TemplateResult {
    const locations = list_maintenance_locations(items);
    if (locations.length <= 1) {
      return html``;
    }
    return html`
      <select
        class="maint-equip-select maint-location-select"
        @change="${(e: Event) => {
          const value = (e.currentTarget as HTMLSelectElement).value;
          this._filter_location = value === "" ? null : value;
          this._filter_device = null;
        }}"
      >
        <option value="" ?selected="${this._filter_location === null}">
          ${this._t("maintenance_all_locations")}
        </option>
        ${locations.map(
          (ref) => html`
            <option
              value="${ref.id}"
              ?selected="${this._filter_location === ref.id}"
            >
              ${ref.name} (${ref.count})
            </option>
          `,
        )}
      </select>
    `;
  }

  private _render_equipment_filter(items: MaintenanceItem[]): TemplateResult {
    const devices = list_maintenance_devices(items);
    if (devices.length <= 1) {
      return html``;
    }
    return html`
      <select
        class="maint-equip-select"
        @change="${(e: Event) => {
          const value = (e.currentTarget as HTMLSelectElement).value;
          this._filter_device = value === "" ? null : value;
        }}"
      >
        <option value="" ?selected="${this._filter_device === null}">
          ${this._t("maintenance_all_equipment")}
        </option>
        ${devices.map(
          (ref) => html`
            <option
              value="${ref.id}"
              ?selected="${this._filter_device === ref.id}"
            >
              ${this._device_label(ref.name, ref.pump_type, ref.pump_model)}
              (${ref.count})
            </option>
          `,
        )}
      </select>
    `;
  }

  /**
   * @param all: items after the configured filters (location dropdown)
   * @param located: items after the location dropdown (equipment dropdown)
   */
  private _render_toolbar(
    all: MaintenanceItem[],
    located: MaintenanceItem[],
  ): TemplateResult {
    return html`
      <div class="maint-toolbar">
        <div class="maint-toolbar-left">
          <div class="maint-sort">
            <button
              id="sort-device"
              class="${this._sort === "device" ? "active" : ""}"
              @click="${() => (this._sort = "device")}"
            >
              ${this._t("sort_by_equipment")}
            </button>
            <button
              id="sort-due"
              class="${this._sort === "due" ? "active" : ""}"
              @click="${() => (this._sort = "due")}"
            >
              ${this._t("sort_by_due_date")}
            </button>
          </div>
          ${this._render_location_filter(all)}
          ${this._render_equipment_filter(located)}
        </div>
        <div class="maint-filters">
          <label class="maint-filter">
            <input
              id="hide-ok"
              type="checkbox"
              .checked="${this._hide_ok}"
              @change="${() => (this._hide_ok = !this._hide_ok)}"
            />
            ${this._t("maintenance_hide_ok")}
          </label>
          <button
            id="hide-muted"
            class="maint-mute-filter ${this._hide_muted ? "active" : ""}"
            title="${this._hide_muted
              ? this._t("maintenance_show_muted")
              : this._t("maintenance_hide_muted")}"
            @click="${() => (this._hide_muted = !this._hide_muted)}"
          >
            <ha-icon
              icon="${this._hide_muted ? "mdi:bell-off-outline" : "mdi:bell"}"
            ></ha-icon>
            <span>
              ${this._hide_muted
                ? this._t("maintenance_show_muted")
                : this._t("maintenance_hide_muted")}
            </span>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Render one task row.
   * @param item: the maintenance item
   * @param options: the effective view options
   * @param subtitle: device (and location) label shown after the name, or ""
   */
  private _render_row(
    item: MaintenanceItem,
    options: MaintenanceViewOptions,
    subtitle: string,
  ): TemplateResult {
    // Overdue tasks always show a full bar, never-reset ones an empty one.
    const fill = item.status === "overdue" ? 100 : item.percent;

    return html`
      <div class="maint-entry">
        <div
          class="maint-row ${item.notify ? "" : "muted"}"
          title="${this._row_title(item)}"
        >
          <ha-icon
            class="maint-icon"
            icon="${item.icon || "mdi:wrench-check"}"
          ></ha-icon>
          <div
            class="maint-body"
            @click="${() => this._more_info(item)}"
            @keydown="${(e: KeyboardEvent) => {
              if (e.key === "Enter") this._more_info(item);
            }}"
          >
            <div class="maint-line">
              <span class="maint-name">
                ${item.name}
                ${item.regulatory
                  ? html`<ha-icon
                      class="maint-regulatory"
                      icon="mdi:scale-balance"
                      title="${this._t("maintenance_regulatory")}"
                    ></ha-icon>`
                  : ""}
                ${subtitle
                  ? html`<span class="maint-device"> - ${subtitle}</span>`
                  : ""}
              </span>
              <span class="maint-remaining ${item.status}">
                ${this._remaining_label(item)}
              </span>
            </div>
            <div class="maint-bar">
              <div
                class="maint-bar-fill ${item.status}"
                style="width: ${fill}%"
              ></div>
            </div>
          </div>
          ${options.show_interval && item.frequency
            ? html`<button
                class="maint-tune ${this._editing === item.entity_id
                  ? "open"
                  : ""}"
                title="${this._t("maintenance_edit_interval")}"
                @click="${() => this._toggle_editor(item)}"
              >
                <ha-icon icon="mdi:calendar-edit"></ha-icon>
              </button>`
            : ""}
          ${options.show_notify && item.can_notify
            ? html`<button
                class="maint-bell ${item.notify ? "on" : "off"}"
                title="${item.notify
                  ? this._t("maintenance_mute")
                  : this._t("maintenance_unmute")}"
                @click="${() => this._toggle_notify(item)}"
              >
                <ha-icon
                  icon="${item.notify ? "mdi:bell-ring" : "mdi:bell-off"}"
                ></ha-icon>
              </button>`
            : ""}
          ${options.show_reset
            ? html`<button
                class="maint-done"
                title="${this._t("maintenance_mark_done")}"
                @click="${() => this._mark_done(item)}"
              >
                <ha-icon icon="mdi:check"></ha-icon>
              </button>`
            : ""}
        </div>
        ${this._editing === item.entity_id ? this._render_editor(item) : ""}
      </div>
    `;
  }

  private _render_editor(item: MaintenanceItem): TemplateResult {
    const f = item.frequency;
    if (f?.mode === "slider") {
      return this._render_slider_editor(item, f);
    }
    return this._render_free_editor(item);
  }

  /** Slider editor of a bounded reef interval (unchanged look). */
  private _render_slider_editor(
    item: MaintenanceItem,
    f: Extract<MaintenanceItem["frequency"], { mode: "slider" }>,
  ): TemplateResult {
    const unit = this._unit_label(f.unit);
    return html`
      <div class="maint-editor">
        <div class="maint-editor-line">
          <span class="maint-editor-label">
            ${this._t("maintenance_every")}
          </span>
          <span class="maint-editor-value">${f.value} ${unit}</span>
        </div>
        <div class="maint-editor-line">
          <span class="maint-editor-bound">${f.min}</span>
          <input
            class="maint-slider"
            type="range"
            min="${f.min}"
            max="${f.max}"
            step="${f.step}"
            .value="${String(f.value)}"
            @change="${(e: Event) =>
              this._set_slider(
                item,
                Number((e.target as HTMLInputElement).value),
              )}"
          />
          <span class="maint-editor-bound">${f.max}</span>
        </div>
      </div>
    `;
  }

  /** Free editor: value + unit, and a seasonal date for yearly tasks. */
  private _render_free_editor(item: MaintenanceItem): TemplateResult {
    const draft = this._draft;
    if (!draft) {
      return html``;
    }
    const months = this._month_names();
    return html`
      <div class="maint-editor">
        <div class="maint-editor-line maint-editor-free">
          <span class="maint-editor-label">
            ${this._t("maintenance_every")}
          </span>
          <input
            class="maint-value"
            type="number"
            min="1"
            max="999"
            .value="${String(draft.value)}"
            @input="${(e: Event) =>
              this._update_draft({
                value: Number((e.target as HTMLInputElement).value) || 1,
              })}"
          />
          <select
            class="maint-unit"
            @change="${(e: Event) =>
              this._update_draft({
                unit: (e.target as HTMLSelectElement).value as MaintenanceUnit,
              })}"
          >
            ${MAINTENANCE_UNITS.map(
              (unit) =>
                html`<option value="${unit}" ?selected="${unit === draft.unit}">
                  ${this._unit_label(unit)}
                </option>`,
            )}
          </select>
        </div>
        ${draft.unit === "years"
          ? html`<div class="maint-editor-line maint-editor-free">
              <label class="maint-editor-seasonal">
                <input
                  class="maint-seasonal"
                  type="checkbox"
                  .checked="${draft.seasonal}"
                  @change="${(e: Event) =>
                    this._update_draft({
                      seasonal: (e.target as HTMLInputElement).checked,
                    })}"
                />
                ${this._t("maintenance_seasonal")}
              </label>
              ${draft.seasonal
                ? html`<input
                      class="maint-day"
                      type="number"
                      min="1"
                      max="${month_length(draft.month)}"
                      .value="${String(draft.day)}"
                      @input="${(e: Event) =>
                        this._update_draft({
                          day: Number((e.target as HTMLInputElement).value) || 1,
                        })}"
                    />
                    <select
                      class="maint-month"
                      @change="${(e: Event) =>
                        this._update_draft({
                          month: Number((e.target as HTMLSelectElement).value),
                        })}"
                    >
                      ${months.map(
                        (name, i) =>
                          html`<option
                            value="${i + 1}"
                            ?selected="${i + 1 === draft.month}"
                          >
                            ${name}
                          </option>`,
                      )}
                    </select>`
                : ""}
            </div>`
          : ""}
        ${draft.seasonal && draft.unit === "years"
          ? html`<div class="maint-editor-hint">
              ${this._t("maintenance_seasonal_hint")}
            </div>`
          : ""}
        <div class="maint-editor-actions">
          <button
            class="maint-cancel"
            @click="${() => this._toggle_editor(item)}"
          >
            ${this._t("maintenance_cancel")}
          </button>
          <button
            class="maint-apply primary"
            @click="${() => this._apply_draft(item)}"
          >
            ${this._t("maintenance_apply")}
          </button>
        </div>
      </div>
    `;
  }

  private _render_groups(
    groups: MaintenanceGroup[],
    options: MaintenanceViewOptions,
  ): TemplateResult {
    return html`${groups.map(
      (group) => html`
        <div class="maint-group-title">
          ${this._device_label(
            group.device_name,
            group.pump_type,
            group.pump_model,
          )}
        </div>
        ${group.items.map((item) => this._render_row(item, options, ""))}
      `,
    )}`;
  }

  private _render_list(
    items: MaintenanceItem[],
    options: MaintenanceViewOptions,
  ): TemplateResult {
    if (items.length === 0) {
      return html`<div class="maint-empty">
        ${this._hide_ok
          ? this._t("maintenance_all_ok")
          : this._t("maintenance_no_task")}
      </div>`;
    }

    const multi_location = list_maintenance_locations(items).length > 1;

    if (this._sort === "due") {
      return html`${items.map((item) => {
        const device = this._device_label(
          item.device_name,
          item.pump_type,
          item.pump_model,
        );
        const subtitle =
          multi_location && item.location_name
            ? `${device} · ${item.location_name}`
            : device;
        return this._render_row(item, options, subtitle);
      })}`;
    }

    if (!multi_location) {
      return this._render_groups(group_by_device(items), options);
    }

    return html`${group_by_location(items).map(
      (location) => html`
        <div class="maint-location-title">
          <ha-icon icon="mdi:map-marker-outline"></ha-icon>
          ${location.location_name}
        </div>
        ${this._render_groups(location.groups, options)}
      `,
    )}`;
  }

  protected override render(): TemplateResult {
    const options = this.view_options;
    const all = this.collect(options);
    this._signature = maintenance_signature(all);

    // Runtime filters from the toolbar dropdowns. A selection that no
    // longer matches anything (filter changed, device removed) is reset.
    let located = all;
    if (this._filter_location !== null) {
      const subset = all.filter((i) => i.location_id === this._filter_location);
      if (subset.length > 0) {
        located = subset;
      } else {
        this._filter_location = null;
      }
    }
    let filtered = located;
    if (this._filter_device !== null) {
      const subset = located.filter((i) => i.device_id === this._filter_device);
      if (subset.length > 0) {
        filtered = subset;
      } else {
        this._filter_device = null;
      }
    }

    let visible = this._hide_ok
      ? filtered.filter((i) => i.status !== "ok")
      : filtered;
    if (this._hide_muted) {
      visible = visible.filter((i) => i.notify);
    }
    const sorted = sort_maintenance_items(visible, this._sort);

    return html`
      <div class="maint-root ${options.embedded ? "embedded" : ""}">
        <div class="maint-header">
          ${options.embedded
            ? ""
            : html`<div class="maint-title">
                <ha-icon icon="mdi:wrench-clock"></ha-icon>
                ${options.title || this._t("maintenance_view")}
              </div>`}
          ${this._render_counters(all)}
        </div>
        ${this._render_toolbar(all, located)} ${this._render_list(sorted, options)}
      </div>
    `;
  }
}

/**
 * Register the view under a bundle specific tag.
 * @param tag: the custom element name
 * @return the tag, for use in templates
 */
export function define_maintenance_view(tag: string = "maintenance-view"): string {
  if (!customElements.get(tag)) {
    // A subclass per tag: the same constructor cannot be defined twice.
    customElements.define(tag, class extends MaintenanceView {});
  }
  return tag;
}
