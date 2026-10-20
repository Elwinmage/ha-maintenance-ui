# ha-maintenance-ui

Shared maintenance view of [ha-reef-card](https://github.com/Elwinmage/ha-reef-card)
and [ha-maintenance-hub](https://github.com/Elwinmage/ha-maintenance-hub): types,
pure logic (status, sorting, grouping, filters), backends, translations and the
`<maintenance-view>` Lit element.

It is not published on npm: consumers depend on a tag of this repository.

```json
"dependencies": {
  "ha-maintenance-ui": "github:Elwinmage/ha-maintenance-ui#v0.1.0"
}
```

## Usage

```ts
import {
  define_maintenance_view,
  hub_backend,
  reef_backend,
} from "ha-maintenance-ui";

// One tag per bundle: two cards shipping different versions of this module
// never fight over the same custom element name.
const TAG = define_maintenance_view("maintenance-hub-view");
```

```ts
html`<maintenance-hub-view
  .hass=${hass}
  .backends=${[hub_backend, reef_backend]}
  .options=${{ sort: "device", title: "Entretien" }}
></maintenance-hub-view>`;
```

Bundlers must deduplicate `lit` (`resolve.dedupe: ["lit"]` with Vite).

## Backends

| Backend | Contract | Entities | Actions |
|---|---|---|---|
| `reef_backend` | `reef_role: maint_*` | button + `_notify` switch + `_interval_<unit>` number | `button.press`, `switch.turn_on/off`, `number.set_value` |
| `hub_backend` | `maint_role: maint_*` | timestamp sensor | `maintenance_hub.reset / set_frequency / set_notify` |

A backend implements `MaintenanceBackend` (`collect`, `reset`, `setFrequency`,
`setNotify`); the view only handles `MaintenanceItem`s.

## Development

```bash
npm install
npm run type-check
npm test
```
