#!/bin/bash

# --- CONFIGURATION ---
EXPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_NAME="org.digitaldefiance.com.complexpatient"
DEVICE_ID="emulator-5554"
KEYSTORE_PATH="$HOME/.android/debug.keystore"
OUTPUT_APKS="my_app.apks"

OPWD="$(pwd)"
cd "$EXPO_ROOT"

# Find the latest build-*.aab file in the current directory
AAB_FILE=$(ls -t build-*.aab 2>/dev/null | head -n 1)

# Check if an AAB file actually exists
if [ -z "$AAB_FILE" ]; then
    echo "❌ Error: No build-*.aab file found in this directory."
    exit 1
fi

echo "📦 Found latest bundle: $AAB_FILE"
echo "----------------------------------------"

# 1. Clean up old generated apks file if it exists
if [ -f "$OUTPUT_APKS" ]; then
    echo "🧹 Removing old $OUTPUT_APKS..."
    rm "$OUTPUT_APKS"
fi

# 2. Uninstall the old app version from the emulator
echo "🗑️  Uninstalling existing app ($PACKAGE_NAME) from $DEVICE_ID..."
adb -s "$DEVICE_ID" uninstall "$PACKAGE_NAME"

# 3. Build and sign the new APKs using bundletool
echo "🔨 Converting and signing AAB into APKs..."
bundletool build-apks \
  --bundle="$AAB_FILE" \
  --output="$OUTPUT_APKS" \
  --ks="$KEYSTORE_PATH" \
  --ks-pass=pass:android \
  --ks-key-alias=androiddebugkey \
  --key-pass=pass:android \
  --local-testing

if [ $? -ne 0 ]; then
    echo "❌ bundletool failed to build the APKs."
    exit 1
fi

# 4. Install the newly generated APKs onto the emulator
echo "📲 Installing new version onto $DEVICE_ID..."
bundletool install-apks --apks="$OUTPUT_APKS" --device-id="$DEVICE_ID"

echo "----------------------------------------"
echo "🎉 Done! Your latest build is ready on the emulator."
cd "${OPWD}"
