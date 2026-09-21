# Grocery POS — Stage 4.8.17

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

## Linux Mint first-time setup

If this POS folder was copied to a new Linux Mint computer, run `./install-linux.sh` from the project folder. It installs the required system build tools, installs Node.js 22 LTS when Node.js is missing or too old, removes copied `node_modules` so Linux gets native dependencies, runs `npm install`, fixes executable permissions, and checks the POS JavaScript files.

Run the installer as your normal user, not with `sudo`. After setup, use `./start-pos-linux.sh` or `./start-manager-linux.sh`.
