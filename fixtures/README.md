# Mock scenarios

These scenarios are in **our own fixture format**, not any feed's wire format.
The mock adapters (`apps/worker/src/feeds/*/mock.ts`) compile them into
normalised feed events for each London date and replay them against a
simulated clock. A scenario without a `date` replays on every date.

All timetable data here is invented for testing. Station codes come from the
unverified demo reference data in `packages/shared/src/reference`.

| file | exercises |
|---|---|
| `01-on-time` | on-time running, both directions |
| `02-progressive-delay` | a delay that grows past alert thresholds, then partly recovers |
| `03-platform-change` | platform changes before departure and at the destination |
| `04-cancellations` | full cancellation, and a part cancellation (terminates short) |
| `05-forming-delay` | a late inbound working forms the user's train; the feed updates the outbound forecast later |
| `06-upstream-incident` | a delayed train ahead on the route, network movements and a cancellation, and a published incident |
| `07-late-night` | a service crossing midnight |
| `08-bst-change` | fixed date 2026-10-24: crosses midnight into the October clock change; its late arrival falls in the repeated hour |

## Format

- `services[]`: `ref`, `uid`, `toc`, `headcode`, optional `ssdOffset` (days),
  and `calls[]` with `tiploc`, `arr`/`dep` (HH:MM London), `plat` and `pass`.
  Times resolve in calling order, so they roll over midnight automatically.
- `associations[]`: `{ main, assoc, kind: forms|join|divide, tiploc }`.
- `timeline[]`: each event has `at` (HH:MM London), plus optional `day` (days
  after the scenario date) and `fold` (`earlier`/`later`, for the October
  repeated hour).
  - `update` lists `calls` with `eta`/`etd`/`ata`/`atd`, `plat`, `platConfirmed`
    and `delayReason`. Each time resolves to the instant nearest that call's
    scheduled time.
  - `cancel` takes a `reason`, and `tiplocs` for a part cancellation.
  - `reinstate` restores a cancelled service.
- `network[]`: `movement` (`trainRef`, `tiploc`, `delayMin`) or `cancellation`.
  Set `ref` when the train is one of the scenario's services.
- `incidents[]`: `id`, `summary`, `description`, `from`/`to` (in the same form
  as `at`), `crs[]` and `tocs[]`.
