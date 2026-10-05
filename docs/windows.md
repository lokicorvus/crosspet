# CrossPet on Windows

Windows 10/11 support uses Electron for the transparent desktop window and the
same HTML, animations, effects and character artwork as the macOS app. The
existing macOS build is still available.

## Build and run

Install [Node.js](https://nodejs.org/) **22.12 or later** with npm. Use native
Windows PowerShell, not WSL. From this repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\app\build.ps1
.\build\CrossPet-win32-x64\CrossPet.exe
```

The first build downloads the pinned Electron Windows runtime. The output is a
portable folder: keep **all its files together**. On Windows ARM64 with ARM64
Node.js the folder is `CrossPet-win32-arm64` (ARM64 has not been tested here).
Node.js is needed to build, but is not needed to run the resulting app.
Use `app\build.ps1 -Zip` to produce a portable zip in `build\`.

To install into `%LOCALAPPDATA%\Programs\CrossPet`, create a Start menu shortcut,
and launch:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

`-SkipBuild` uses an existing build. `-NoLaunch` installs without launching.
Re-run the installer after updating your local source to update the installed
app. It does not fetch, push or publish repository changes. The upstream macOS
release zip and `get.sh` are **not Windows installers**.

For development:

```powershell
cd app\windows
npm ci
npm start
```

## AI hooks

Install Python 3.9 or later and make sure `python --version` works from the same
Windows account that runs your AI applications. From the repository root:

```powershell
python tools\integrate.py install codex
python tools\integrate.py install claude-hooks
python tools\integrate.py install gemini
python tools\integrate.py install antigravity
python tools\integrate.py install deepseek
python tools\integrate.py status
```

Run only the commands for integrations you use. Each command backs up and merges
the application's settings; it preserves unrelated hooks. The helper installs
`crosspet-hook.py` automatically, even before the first app launch. You can also
use `resources\app\tools\integrate.py` in the installed/portable folder. Restart
the relevant AI session after installing hooks and approve hooks in the AI
application where required. Use `uninstall` instead of `install` to remove an
integration. `python tools\integrate.py refresh` refreshes installed integrations
after an update, including the DeepSeek plugin.

The DeepSeek integration copies the plugin on Windows, so it does not require
administrator rights or Windows Developer Mode for symlinks.

## Interaction and settings

- Click to pat; drag to move. The position is saved and recovered if a monitor
  is disconnected.
- Right-click for characters, renaming, poking, easter eggs, optional Codex quota,
  login startup, reload and quit. **Alt + right-click** opens the menu with the
  developer console. It is also available from the tray icon's menu.
- Double-click the tray icon to bring the pet back to the lower right corner.
- Login startup is available in the built executable, not `npm start`. Install
  first so its executable path remains stable.
- Switching to a supported desktop application's executable changes character
  after a short delay. For CLI tools in a terminal, select the character from
  the menu. Browser tabs and terminal titles are not inspected.

User data is in `%LOCALAPPDATA%\CrossPet`:

| Location | Contents |
|---|---|
| `characters\` | Built-in and custom characters |
| `settings.json` | Names, selected character, position, quota preference |
| `crosspet-hook.py` | Installed shared hook |
| `browser\` | Local animation/quota memory and developer console settings |
| `dev-feedback.md` | Feedback saved from the developer console |

The state directory is `%TEMP%\crosspet`, shared by the desktop host, Python
hooks and DeepSeek plugin. `CROSSPET_STATE_DIR` overrides it; all processes must
receive the same value. `CROSSPET_HOME` overrides the user-data directory for
the Windows host and integration helper. Codex hooks and quota reading honor
`CODEX_HOME`. Native Windows and WSL have different temporary directories; WSL
hooks require an explicitly shared state directory.

Custom `character.json` files can specify Windows process names:

```json
"windowsApps": ["Claude.exe", "Codex.exe"]
```

Names are case-insensitive and `.exe` is optional. The existing `apps` field
continues to contain macOS bundle identifiers. Built-in character artwork is
refreshed at startup; use a new character folder for persistent customization.

## Platform differences

- The Claude enhanced mod depends on its macOS sandbox. On Windows, use
  `claude-hooks`; automatic Claude quota from that mod is not available.
- Antigravity/Gemini hooks work on Windows. Automatic polling of the local
  Antigravity quota service remains macOS-only. Windows still accepts quota
  JSON supplied by an integration in the shared state directory.
- Codex quota reading is optional and off by default. It reads recent local
  session logs; DeepSeek balance is supplied by its plugin as on macOS.
- The Windows host does not poll GitHub for updates. The menu links to this
  fork's source; rebuild/reinstall to update.

## Test

```powershell
npm --prefix app\windows test
python -m unittest discover -s tools -p test_*.py
npm --prefix app\windows run test:smoke
npm --prefix app\windows run test:package  # after building
```

The smoke test runs the real Windows UI, briefly opens a foreground test window,
and checks transparency, native dragging, loaded artwork, hook-to-animation delivery, quotas,
foreground detection, renaming and the developer console. It uses an isolated
`build\smoke-*` profile and saves `build\windows-smoke.png`; it does not modify
your AI configurations. Run it from an ordinary interactive Windows session.
The package test also launches the built `CrossPet.exe` with an isolated profile,
verifies its bundled renderer/artwork, and closes its own process tree.

## Uninstall

Quit CrossPet, then run from this checkout:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1 -RemoveIntegrations
```

Or run `uninstall.ps1` inside the installed folder. `-InstallDir` selects a custom
installation. Omit `-RemoveIntegrations` to retain hooks for another build.
The script removes only a verified CrossPet installation and its matching login
entry/shortcut. User data and custom characters are retained. A portable copy
can also be removed after disabling login startup and removing its integrations.
