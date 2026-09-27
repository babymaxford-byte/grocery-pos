# Grocery POS 4.9.0

## Debt Tracker
- Owner Center > Debt Tracker for supplier deliveries and unpaid balances.
- Record delivery date, supplier, multiple supply lines, costs, and notes.
- Record multiple dated partial/full payments.
- Remaining balances and Unpaid / Partially Paid / Paid status are calculated automatically.
- Debt and payment changes are recorded in the audit log.
- Debt data is included in complete backups; older backups without debt tables remain restorable.

# Grocery POS — Stage 4.8.22

## EverJoy POS Manager — Automatic Updates

Stage 4.8.17 upgrades the graphical Manager with a safe local update system, complete backups, application rollback, backup downloads, storage information, and a redesigned touch-friendly interface.

### Manager

Windows:
- `start-manager-windows.bat`

Linux:
- `./start-manager-linux.sh`

Or:
```bash
node manager.js start --ui --no-browser
```

Manager UI:
`http://127.0.0.1:3010/`

### Update workflow

1. Open **Manager → Updates**.
2. Choose the new Grocery POS `.zip`.
3. Validate the package.
4. Click **Install Update** and confirm.
5. The Manager creates a complete backup automatically.
6. The POS is stopped and application files are updated.
7. Dependencies are installed with `npm install` when needed.
8. The new Manager starts and performs a health check.
9. If startup fails, the previous application files are restored automatically.

The update system protects the live `data/` directory. It does not replace `data/pos.sqlite` or `data/product-images/` during a normal application update. Manager-created pre-update backups are stored under `data/.manager/backups/`.

### Manager improvements

- Dashboard with live Manager, server, frontend, version, PID, Node, platform, storage, and database information.
- Touch-friendly navigation for Dashboard, Updates, Backups, and Logs.
- Complete backup creation from the Manager.
- Recent backup list with download buttons.
- Update package validation and progress.
- Automatic pre-update backup.
- Separate updater process so the running Manager can be replaced safely on Windows/Linux.
- Automatic application rollback if the updated Manager fails its health check.
- Local-only control API bound to `127.0.0.1`.

### Update package requirements

An update ZIP must contain a Grocery POS `package.json` and the required application files. Protected folders such as `data/`, `node_modules/`, and `.manager/` are rejected from update packages.

### Development

```powershell
npm install
npm run dev
```

Manager:
```powershell
node manager.js start --ui --no-browser
```


## Display mode

Windows and Linux browser launchers open the POS and Manager in kiosk mode (fullscreen, no browser tabs/address bar). Use Alt+F4 to close the kiosk window.


## Windows first-time setup

If this POS folder was copied to a new Windows computer, run `install-windows.bat` from the extracted project folder. The installer checks for Node.js 20+, attempts to install Node.js 22 LTS with Windows Package Manager when needed, runs `npm install`, checks the POS files, and creates local Windows launchers.

Run `install-windows.bat` as a normal Windows user. Administrator permission may be requested by Windows Package Manager when Node.js is installed.

After setup, use `start-manager-windows.bat` to launch the Manager and POS, or `start-pos-windows.bat` to start the POS through the Manager without opening the Manager UI.

## Linux Mint first-time setup

If this POS folder was copied to a new Linux Mint computer, run `./install-linux.sh` from the project folder. It installs the required system build tools, installs Node.js 22 LTS when Node.js is missing or too old, removes copied `node_modules` so Linux gets native dependencies, runs `npm install`, fixes executable permissions, and checks the POS JavaScript files.

Run the installer as your normal user, not with `sudo`. After setup, use `./start-pos-linux.sh` or `./start-manager-linux.sh`.


### Online GitHub Updates

The Manager can check the configured public GitHub repository for its latest published release. The default repository is `babymaxford-byte/grocery-pos`. Releases should include a `.zip` Grocery POS package as a release asset. The Manager compares the release version with the installed version, downloads the ZIP over HTTPS, verifies the GitHub-provided SHA-256 digest when available, validates the package, and then uses the existing safe backup/install/rollback workflow. The POS itself remains fully usable offline; only update checking/downloading requires Internet access.

Recommended release format:

- Tag: `v4.8.22`
- Asset: `grocery-pos-stage-4.8.22.zip`
- Publish the release (not a draft or prerelease)


### 4.8.22
- Fixed Stop POS so it also terminates POS processes detected by their listening ports, including processes started outside the Manager.
- Added Force Stop POS control.
- Prevented Manager child-process tracking from leaving the actual POS server/frontend running.


## Stage 4.9.4
- Debt Tracker supply lines now include quantity, description, and total cost.
- Fast keyboard entry: Quantity -> Tab -> Supply -> Tab -> Cost -> Enter creates/focuses the next row.
- Admin Session Timeout now supports Never (manual lock only).


## 4.9.7 update packaging

Application update packages intentionally omit the launcher shell/batch scripts (`start-manager-linux.sh`, `start-manager-windows.bat`, `start-pos-linux.sh`, `start-pos-windows.bat`). The Manager preserves the existing launcher files during updates so Linux executable permissions are not replaced. Keep the existing launcher files on installed machines.
