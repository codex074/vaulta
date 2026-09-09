# Admin Disk Status — Design Spec

Date: 2026-09-09. Status: approved by the user in chat (SMART of the physical
disks only; opened from a "Disk status" button in the admin account menu;
Proxmox API token approach).

## Goal

An admin opens the account menu, clicks **Disk status**, and sees every
physical disk behind the NAS: SMART health (PASSED/FAILED), temperature,
power-on hours, bad-sector counters for HDDs, wear for SSD/NVMe, and when the
numbers were read. Numbers are always live from this run or the dialog says
they are unavailable — never estimated.

## Verified facts

- TrueNAS runs as **VM 105 on Proxmox `pve2`** (`192.168.1.16`). Inside the VM
  the disks are `QEMU HARDDISK`: no SMART, `disk.temperatures` returns null.
  Disk health can only come from the Proxmox host.
- Proxmox API (pve-manager 9.2) exposes, with `Sys.Audit` on `/`:
  - `GET /api2/json/nodes/pve2/disks/list` → `data: [{devpath, model, serial,
    size, type: "hdd"|"ssd"|"nvme", health: "PASSED"|"FAILED"|"UNKNOWN",
    wearout: <int remaining-life %> | "N/A", used: "ZFS"|"BIOS boot"|…,
    by_id_link, rpm}]`
  - `GET /api2/json/nodes/pve2/disks/smart?disk=/dev/sda` → `data: {health,
    type: "ata", attributes: [{id: "  9" (space padded string), name, raw
    (string, may be "44 (Min/Max 34/47)"), value, normalized, threshold,
    worst, fail}]}`
  - `GET …/disks/smart?disk=/dev/nvme0n1` → `data: {health, type: "text",
    wearout, text: "SMART/Health Information …\nTemperature: 49 Celsius\n
    Percentage Used: 4%\nPower On Hours: 7,249\nMedia and Data Integrity
    Errors: 0\n…"}`
  Real samples captured 2026-09-09 live in `docker/nasapi/testdata/pve-*.json`.
- The VM reaches `https://192.168.1.16:8006`. The node cert `pve-ssl.pem` is
  issued by the cluster's own CA (`/etc/pve/pve-root-ca.pem`, "PVE Cluster
  Manager CA", valid to 2036-08) and its SANs include `192.168.1.16`, so
  trusting that CA gives normal, hostname-checked TLS verification.
- Proxmox side: role `VaultaDiskAudit` (`Sys.Audit` only), user `vaulta@pve`
  with that role on `/`, token `vaulta@pve!disks` (privsep off so it inherits
  exactly that role). The token cannot start/stop VMs (verified 403).

## Backend (`docker/nasapi`)

**Config file** `<NASAPI_DATA_PATH>/proxmox.json` (0600, written once by the
operator; absent ⇒ feature "not configured"):

```json
{
  "url": "https://192.168.1.16:8006",
  "node": "pve2",
  "tokenId": "vaulta@pve!disks",
  "secret": "<uuid>",
  "caFile": "/var/lib/vaulta/proxmox-ca.pem",
  "labels": { "/dev/sda": "NAS data (tank)", "/dev/nvme0n1": "Proxmox boot / VM system disk" }
}
```

Loaded at startup; a missing file is not an error (endpoint answers 503),
a malformed file is logged and treated the same.

**Endpoint** `GET /system/disks` (nginx exposes it as `/nasapi/system/disks`).
Admin only via the existing `requireAdmin`. Response:

```json
{
  "checkedAt": "2026-09-09T16:40:00Z",
  "node": "pve2",
  "disks": [
    {
      "devpath": "/dev/sda", "label": "NAS data (tank)",
      "model": "ST2000LM007-1R8174", "serial": "WDZQLV5G",
      "sizeBytes": 2000398934016, "type": "hdd", "usedBy": "ZFS",
      "health": "PASSED",
      "temperatureC": 44,
      "powerOnHours": 5823,
      "reallocatedSectors": 0, "pendingSectors": 0,
      "wearPercent": null
    },
    {
      "devpath": "/dev/nvme0n1", "label": "Proxmox boot / VM system disk",
      "type": "nvme", "health": "PASSED", "temperatureC": 49,
      "powerOnHours": 7249, "wearPercent": 4,
      "reallocatedSectors": null, "pendingSectors": null, "mediaErrors": 0
    }
  ]
}
```

Rules:
- `health` is `PASSED`, `FAILED` or `UNKNOWN` (anything else from Proxmox maps
  to `UNKNOWN`). Any numeric field the source did not provide is `null`, never
  0 or a guess.
- ATA parsing: temperature from attribute id 194 (`Temperature_Celsius`),
  falling back to 190 (`Airflow_Temperature_Cel`); take the leading integer of
  `raw`. Power-on hours from id 9 (leading integer). Reallocated from id 5,
  pending from id 197. Ids are trimmed before comparison.
- NVMe/`text` parsing: regexes over the text for `Temperature:\s+(\d+)`,
  `Percentage Used:\s+(\d+)%`, `Power On Hours:\s+([\d,]+)` (strip commas),
  `Media and Data Integrity Errors:\s+([\d,]+)`. `wearPercent` = Percentage
  Used; if absent, fall back to `100 - wearout` from the list entry when
  wearout is numeric.
- SSD (non-NVMe, ATA attributes): `wearPercent` = `100 - wearout` from the list
  entry when numeric, else null.
- One Proxmox round-trip for the list plus one per disk for SMART, 10 s total
  HTTP timeout. Results cached in memory for 60 s (`?refresh=1` bypasses the
  cache; the dialog's Refresh button uses it).
- TLS: standard verification. When `caFile` is set, its PEM is loaded into
  a `x509.CertPool` used as `tls.Config.RootCAs` (hostname/IP still checked
  against the URL). No `caFile` ⇒ the system trust store. Verification is
  never disabled.
- Errors: not configured → 503 `{"error":"Disk monitoring is not configured."}`;
  Proxmox unreachable / non-2xx / bad JSON → 502 with a short message. Never
  serve a partial list silently: if one disk's SMART call fails, that disk is
  returned with `health: "UNKNOWN"` and an `error` string, the rest intact.
- New env var: none. `NASAPI_DATA_PATH` already locates the file.

## Frontend

- `src/api/system.js`: `getDiskStatus({ refresh })` → `authorizedFetch('/nasapi/system/disks')`.
- `src/components/diskStatus.js` (pure helpers, unit-tested):
  `temperatureLevel(type, c)` → `ok | warn | hot | unknown`
  (hdd: <45 ok, 45–50 warn, >50 hot; ssd/nvme: <60 ok, 60–70 warn, >70 hot),
  `healthLevel(health)` → `ok | bad | unknown`, `formatHours(h)` → "5,823 h · 243 days".
- `DiskStatusDialog.vue`: same shell/patterns as `ManageUsersDialog.vue`
  (`dialogFocus`, close on Esc/backdrop). States: loading, error (message +
  Retry), not configured (explains the `proxmox.json` file), list. One card
  per disk: label + model/serial/size, health badge, temperature chip coloured
  by level, power-on hours, HDD: reallocated/pending sectors; SSD/NVMe: wear %,
  media errors. Footer: "Checked <relative time>" + Refresh button (calls with
  `refresh: true`).
- `Sidebar.vue`: "Disk status" button under "Manage users", admin only,
  opens the dialog.

## Ops

- Write `proxmox.json` and `proxmox-ca.pem` (copy of pve2's
  `/etc/pve/pve-root-ca.pem`) into `/mnt/.ix-apps/app_mounts/nas-webui/config/`
  on VM 105 via `qm guest exec 105 --pass-stdin` (secret never on argv).
- Deploy the image with the usual scp → http.server → `docker load` →
  `docker compose -p ix-nas-webui up -d --force-recreate`.
- README: new "Disk status (admin)" section documenting the Proxmox role/token
  and the config file; env table unchanged.
- Known limitation: if the Proxmox cluster CA is ever regenerated (current one
  is valid to 2036-08), replace `proxmox-ca.pem`.

## Testing

- Go (`disks_test.go`): httptest server replaying the testdata; asserts the
  normalized JSON for both disks; FAILED health; missing attributes → null;
  per-disk SMART failure → UNKNOWN + error; 503 when unconfigured; 403 for
  non-admin; cache hit vs `refresh=1`; a server cert not signed by the
  configured CA is rejected.
- Vitest: `diskStatus.test.js` for the helpers; `DiskStatusDialog.test.js`
  for the four states and colour classes; Sidebar test that the button is
  admin-only.
- Live: open the dialog on nas.codex074.com in Chrome after deploy.
