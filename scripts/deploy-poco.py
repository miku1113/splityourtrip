#!/usr/bin/env python3
import os
import sys
import json
import time
import socket
import shutil
import urllib.request
import subprocess
from concurrent.futures import ThreadPoolExecutor

PACKAGE_NAME = "com.splityourtrip"
POCO_TAILSCALE_IP_DEFAULT = "100.75.151.89"
REPO_OWNER = "miku1113"
REPO_NAME = "splityourtrip"
LOCAL_APK_DIR = os.path.expanduser("~/Desktop/apks/splitYourTrip")

def find_adb():
    candidate_paths = [
        os.path.expanduser("~/Library/Android/sdk/platform-tools/adb"),
        "/opt/homebrew/bin/adb",
        "/usr/local/bin/adb",
        shutil.which("adb")
    ]
    for p in candidate_paths:
        if p and os.path.exists(p) and os.access(p, os.X_OK):
            return p
    return "adb"

def get_poco_ip():
    tailscale_bin = shutil.which("tailscale") or "/usr/local/bin/tailscale" or "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
    if os.path.exists(tailscale_bin):
        try:
            res = subprocess.run([tailscale_bin, "status", "--json"], capture_output=True, text=True, timeout=5)
            if res.returncode == 0:
                data = json.loads(res.stdout)
                for peer in data.get("Peer", {}).values():
                    if "poco" in peer.get("HostName", "").lower():
                        ips = peer.get("TailscaleIPs", [])
                        if ips:
                            return ips[0]
        except Exception:
            pass
    return POCO_TAILSCALE_IP_DEFAULT

def scan_open_port(ip):
    print(f"[*] Scanning ADB wireless debugging port on {ip}...")
    ports_to_check = [5555] + list(range(30000, 48000))

    def check(p):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.35)
                if s.connect_ex((ip, p)) == 0:
                    return p
        except Exception:
            pass
        return None

    with ThreadPoolExecutor(max_workers=250) as executor:
        for open_port in executor.map(check, ports_to_check):
            if open_port:
                print(f"[+] Found open ADB port: {open_port}")
                return open_port

    return None

def fetch_latest_release_apk():
    os.makedirs(LOCAL_APK_DIR, exist_ok=True)
    url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/releases?per_page=5"
    req = urllib.request.Request(url, headers={"User-Agent": "SplitYourTrip-AutoDeploy"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            releases = json.loads(resp.read().decode())
            for r in releases:
                tag = r.get("tag_name", "")
                if "android" in tag or not ("ios" in tag):
                    for a in r.get("assets", []):
                        if a.get("name", "").endswith(".apk"):
                            apk_url = a.get("browser_download_url")
                            size_mb = round(a.get("size", 0) / (1024 * 1024), 1)
                            version = tag.split("-")[0].replace("v", "")
                            target_filename = f"SplitYourTrip-v{version}.apk"
                            target_path = os.path.join(LOCAL_APK_DIR, target_filename)
                            fallback_path = os.path.join(LOCAL_APK_DIR, "app-release.apk")

                            if not os.path.exists(target_path) or os.path.getsize(target_path) < 1000000:
                                print(f"[*] Downloading {target_filename} ({size_mb} MB) from GitHub Releases...")
                                urllib.request.urlretrieve(apk_url, target_path)
                                shutil.copy2(target_path, fallback_path)
                                print(f"[+] Download complete: {target_path}")
                            else:
                                print(f"[+] Using cached APK: {target_path} ({size_mb} MB)")
                                if not os.path.exists(fallback_path):
                                    shutil.copy2(target_path, fallback_path)

                            return target_path
    except Exception as e:
        print(f"[-] Could not query GitHub Releases: {e}")

    # Fallback to local APK if exists
    fallback_path = os.path.join(LOCAL_APK_DIR, "app-release.apk")
    if os.path.exists(fallback_path):
        return fallback_path

    return None

def main():
    print("=" * 60)
    print(" SplitYourTrip — Poco Device Tailscale Auto-Deploy ")
    print("=" * 60)

    adb = find_adb()
    print(f"[*] Using ADB: {adb}")

    ip = get_poco_ip()
    print(f"[*] Poco Device IP: {ip}")

    # 1. Locate latest APK
    apk_path = fetch_latest_release_apk()
    if not apk_path or not os.path.exists(apk_path):
        print("[-] Error: Could not locate or download APK!")
        sys.exit(1)

    print(f"[+] Ready to deploy APK: {apk_path}")

    # 2. Check if already connected
    devices_proc = subprocess.run([adb, "devices"], capture_output=True, text=True)
    connected_target = None
    for line in devices_proc.stdout.splitlines():
        if ip in line and "device" in line and not "offline" in line:
            connected_target = line.split()[0]
            print(f"[+] Already connected to {connected_target}")
            break

    # 3. If not connected, scan and connect
    if not connected_target:
        port = scan_open_port(ip)
        if not port:
            print("[-] Error: No open wireless debugging port found on Poco device.")
            print("    Please ensure:")
            print("    1. Poco phone screen is unlocked and connected to WiFi.")
            print("    2. Wireless Debugging is turned ON in Developer Options.")
            print("    3. Tailscale is running on the Poco device.")
            sys.exit(2)

        target_addr = f"{ip}:{port}"
        print(f"[*] Connecting ADB to {target_addr}...")
        conn_res = subprocess.run([adb, "connect", target_addr], capture_output=True, text=True)
        print(conn_res.stdout.strip())
        time.sleep(1)
        connected_target = target_addr

    # 4. Direct update install (preserves all data and settings)
    print(f"[*] Directly updating app on {connected_target}...")
    install_res = subprocess.run(
        [adb, "-s", connected_target, "install", "-r", "-d", apk_path],
        capture_output=True,
        text=True
    )
    print(install_res.stdout.strip())
    if "Success" not in install_res.stdout:
        print(f"[-] Installation failed: {install_res.stderr.strip()}")
        sys.exit(3)

    print("[+] App updated successfully on Poco device!")

    # 5. Launch the app
    print("[*] Launching updated app...")
    subprocess.run([
        adb, "-s", connected_target, "shell", "monkey",
        "-p", PACKAGE_NAME,
        "-c", "android.intent.category.LAUNCHER", "1"
    ], capture_output=True, text=True)

    # 6. Verify version info
    dumpsys = subprocess.run(
        [adb, "-s", connected_target, "shell", "dumpsys", "package", PACKAGE_NAME],
        capture_output=True,
        text=True
    )
    for line in dumpsys.stdout.splitlines():
        if "versionName" in line:
            print(f"[+] Verified on-device: {line.strip()}")
            break

    print("=" * 60)
    print(" Deployment Complete! App is live on Poco Device ")
    print("=" * 60)

if __name__ == "__main__":
    main()
