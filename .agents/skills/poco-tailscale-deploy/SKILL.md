---
name: poco-tailscale-deploy
description: >-
  Automatically connect to the user's Poco device (poco-m4-5g) over Tailscale (100.75.151.89),
  scan for open ADB wireless debugging ports, fetch/build the latest release APK, directly update
  the app with `adb install -r -d` without data loss, and launch the app automatically.
---

# Poco Device Tailscale Auto-Deploy Skill

Use this skill whenever the user asks to install, update, test, or deploy SplitYourTrip (or any updated build) onto their **Poco device** over Tailscale without manual prompting or repeated instructions.

---

## 1. Fast One-Step Execution

Run the automated Python deployment utility:

```bash
python3 scripts/deploy-poco.py
```

This single command executes the entire deployment workflow:
1. Detects `adb` and checks Tailscale peer status for `POCO M4 5G` (`100.75.151.89`).
2. High-speed multi-threaded port scan across dynamic wireless debugging ports (`5555` and `30000..48000`).
3. Connects via `adb connect 100.75.151.89:<port>`.
4. Retrieves latest release APK from GitHub Releases (or local builds) and saves to `~/Desktop/apks/splitYourTrip/`.
5. Executes direct update `adb install -r -d <apk_path>` to preserve user sessions, trips, and settings.
6. Launches `com.splityourtrip` immediately using `am` or `monkey`.
7. Dumps and verifies installed `versionName` and `versionCode`.

---

## 2. Manual Step-by-Step Fallback Workflow

If executing manually:

### Step 1: Scan for Wireless Debugging Port
```python
import socket
from concurrent.futures import ThreadPoolExecutor

ip = "100.75.151.89"
def check(p):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.35)
            if s.connect_ex((ip, p)) == 0:
                return p
    except: pass
    return None

with ThreadPoolExecutor(max_workers=250) as ex:
    for p in ex.map(check, [5555] + list(range(30000, 48000))):
        if p:
            print("FOUND_PORT:", p)
            break
```

### Step 2: Connect ADB
```bash
export PATH="$HOME/Library/Android/sdk/platform-tools:/usr/local/bin:$PATH"
adb connect 100.75.151.89:<PORT>
```

### Step 3: Ensure APK Destination (Rule 8)
Always ensure destination:
```bash
mkdir -p ~/Desktop/apks/splitYourTrip
# Ensure ~/Desktop/apks/splitYourTrip/SplitYourTrip-v<ver>.apk and app-release.apk exist
```

### Step 4: Direct Update Install (Never Wipe Data)
```bash
adb -s 100.75.151.89:<PORT> install -r -d ~/Desktop/apks/splitYourTrip/app-release.apk
```

### Step 5: Launch & Verify
```bash
adb -s 100.75.151.89:<PORT> shell monkey -p com.splityourtrip -c android.intent.category.LAUNCHER 1
adb -s 100.75.151.89:<PORT> shell dumpsys package com.splityourtrip | grep -E "versionName|versionCode"
```

---

## 3. Troubleshooting
- **Connection Refused / Port Offline**:
  - The Poco phone screen may have locked or changed WiFi networks.
  - Ask user to tap/wake their phone screen and ensure Wireless Debugging in Developer Options is active.
- **Tailscale Ping Timeout**:
  - Check `tailscale status` on Mac to ensure `poco-m4-5g` has an active tunnel.
