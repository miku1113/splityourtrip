#!/bin/bash
# ==============================================================
# SplitYourTrip - Live APK Build Monitor
# ==============================================================

# ANSI Color Codes
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

clear
echo -e "${CYAN}${BOLD}======================================================${NC}"
echo -e "${CYAN}${BOLD}       SplitYourTrip - Live APK Build Monitor         ${NC}"
echo -e "${CYAN}${BOLD}======================================================${NC}"
echo ""

PROJECT_DIR="/Users/mihir/Desktop/splitYourTrip"
APP_JSON="$PROJECT_DIR/app.json"
BUILD_GRADLE="$PROJECT_DIR/android/app/build.gradle"
APK_PATH="$PROJECT_DIR/splitYourTrip.apk"
DESKTOP_APK="/Users/mihir/Desktop/splitYourTrip.apk"
RELEASE_APK="$PROJECT_DIR/android/app/build/outputs/apk/release/app-release.apk"

# Dynamically resolve current version and build number
APP_VERSION=$(grep '"version":' "$APP_JSON" 2>/dev/null | head -n 1 | awk -F '"' '{print $4}')
VERSION_CODE=$(grep '"versionCode":' "$APP_JSON" 2>/dev/null | head -n 1 | awk -F ':' '{print $2}' | tr -d ' ,')

if [ -z "$APP_VERSION" ]; then
  APP_VERSION=$(grep 'versionName' "$BUILD_GRADLE" 2>/dev/null | head -n 1 | awk -F '"' '{print $2}')
fi
if [ -z "$VERSION_CODE" ]; then
  VERSION_CODE=$(grep 'versionCode' "$BUILD_GRADLE" 2>/dev/null | head -n 1 | awk '{print $2}' | tr -d ' ,')
fi

# Dynamically find the latest build log across Antigravity tasks
LATEST_LOG=""
for b_dir in $(ls -dt /Users/mihir/.gemini/antigravity-ide/brain/*/ 2>/dev/null); do
  TASK_DIR="${b_dir}.system_generated/tasks"
  if [ -d "$TASK_DIR" ]; then
    for file in $(ls -t "$TASK_DIR"/task-*.log 2>/dev/null); do
      if grep -q -E "(assembleRelease|BUILD SUCCESSFUL|BUILD FAILED|compileRelease|react-native|expo-modules-core|app:packageRelease)" "$file" 2>/dev/null; then
        LATEST_LOG="$file"
        break 2
      fi
    done
  fi
done

# Fallback: most recently created task log in latest brain directory
if [ -z "$LATEST_LOG" ]; then
  for b_dir in $(ls -dt /Users/mihir/.gemini/antigravity-ide/brain/*/ 2>/dev/null); do
    TASK_DIR="${b_dir}.system_generated/tasks"
    if [ -d "$TASK_DIR" ]; then
      LATEST_LOG=$(ls -t "$TASK_DIR"/task-*.log 2>/dev/null | head -n 1)
      if [ -n "$LATEST_LOG" ]; then
        break
      fi
    fi
  done
fi

if [ -z "$LATEST_LOG" ] || [ ! -f "$LATEST_LOG" ]; then
  echo -e "${RED}Error: No active or recent build logs found.${NC}"
  echo ""
  read -p "Press [Enter] to exit..."
  exit 1
fi

echo -e "Target Version: ${BOLD}v${APP_VERSION} (Build ${VERSION_CODE})${NC}"
echo -e "Tracking Log:   ${YELLOW}$LATEST_LOG${NC}"
echo "------------------------------------------------------"

# Function to show build success summary
show_success() {
  echo ""
  echo -e "${GREEN}${BOLD}======================================================${NC}"
  echo -e "${GREEN}${BOLD}   >>> BUILD ${VERSION_CODE} (v${APP_VERSION}) COMPLETED SUCCESSFULLY! <<<   ${NC}"
  echo -e "${GREEN}${BOLD}======================================================${NC}"
  echo ""
  grep -A 2 "BUILD SUCCESSFUL" "$LATEST_LOG" 2>/dev/null
  echo ""

  # Ensure latest built APK is copied to designated spots
  if [ -f "$RELEASE_APK" ]; then
    cp "$RELEASE_APK" "$APK_PATH" 2>/dev/null
    cp "$RELEASE_APK" "$DESKTOP_APK" 2>/dev/null
  fi

  if [ -f "$APK_PATH" ]; then
    echo -e "${GREEN}✓ Project APK located at:${NC}"
    ls -lh "$APK_PATH"
  fi
  if [ -f "$DESKTOP_APK" ]; then
    echo -e "${GREEN}✓ Desktop APK located at:${NC}"
    ls -lh "$DESKTOP_APK"
  fi
  echo ""
  echo -e "${CYAN}You can now transfer and install 'splitYourTrip.apk' (v${APP_VERSION}, Build ${VERSION_CODE}) on your Android device.${NC}"
}

# Function to show build failure summary
show_failure() {
  echo ""
  echo -e "${RED}${BOLD}======================================================${NC}"
  echo -e "${RED}${BOLD}             >>> BUILD FAILED <<<                     ${NC}"
  echo -e "${RED}${BOLD}======================================================${NC}"
  echo ""
  tail -n 35 "$LATEST_LOG"
  echo ""
}

# Check if build is already finished
if grep -q "BUILD SUCCESSFUL" "$LATEST_LOG"; then
  show_success
elif grep -q "BUILD FAILED" "$LATEST_LOG"; then
  show_failure
else
  echo -e "${YELLOW}Build in progress... Streaming live terminal output:${NC}"
  echo -e "${CYAN}(Press Ctrl+C at any time if you wish to detach)${NC}"
  echo "------------------------------------------------------"
  
  # Stream live output and break when finished
  tail -n 25 -f "$LATEST_LOG" &
  TAIL_PID=$!
  
  trap "kill $TAIL_PID 2>/dev/null; exit 0" SIGINT SIGTERM
  
  while kill -0 "$TAIL_PID" 2>/dev/null; do
    if grep -q "BUILD SUCCESSFUL" "$LATEST_LOG"; then
      sleep 2
      kill "$TAIL_PID" 2>/dev/null
      wait "$TAIL_PID" 2>/dev/null
      show_success
      break
    elif grep -q "BUILD FAILED" "$LATEST_LOG"; then
      sleep 2
      kill "$TAIL_PID" 2>/dev/null
      wait "$TAIL_PID" 2>/dev/null
      show_failure
      break
    fi
    sleep 1
  done
fi

echo ""
echo "------------------------------------------------------"
read -p "Press [Enter] to exit..."
