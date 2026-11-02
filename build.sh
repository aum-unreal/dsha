#!/data/data/com.termux/files/usr/bin/bash
# No-Gradle build (recipe A in ~/android-dev/TOOLCHAIN.md).
#   ./build.sh             DSHA, the Termux build (dev.aum.dsha)            → dsha.apk
#   ./build.sh standalone  DSHA Standalone, dsh and Node inside the app      → dsha-standalone.apk
# Standalone adds runtime/arm64-v8a (scripts/prepare-runtime.sh, from Termux's node) as
# lib/arm64-v8a/*.so, dsh's source as assets/dsh, and the Backend service to the manifest.
set -euo pipefail
cd "$(dirname "$0")"
FLAVOR=${1:-termux}
ANDROID_JAR="$HOME/dev/sdk/android.jar"
rm -rf build && mkdir -p build/{res,gen,classes,dex}
MANIFEST=AndroidManifest.xml ASSETS=assets OUT=dsha.apk LINK=()
if [ "$FLAVOR" = standalone ]; then
  [ -f runtime/arm64-v8a/libnode.so ] || scripts/prepare-runtime.sh
  MANIFEST=build/AndroidManifest.xml ASSETS=build/assets OUT=dsha-standalone.apk
  LINK=(--rename-manifest-package dev.aum.dsha.standalone --custom-package dev.aum.dsha)
  cp -r assets build/assets && cp -r server build/assets/dsh && rm -rf build/assets/dsh/test
  python - <<'PY'
m = open('AndroidManifest.xml').read()
perms = ''.join(f'  <uses-permission android:name="android.permission.{p}"/>\n' for p in ['MANAGE_EXTERNAL_STORAGE'])
m = m.replace('  <uses-permission android:name="android.permission.INTERNET"/>\n', '  <uses-permission android:name="android.permission.INTERNET"/>\n' + perms, 1)
m = m.replace('android:label="DSHA"', 'android:label="DSHA Standalone" android:extractNativeLibs="true"', 1)
svc = ('    <service android:name=".Backend" android:exported="false" android:foregroundServiceType="specialUse">\n'
       '      <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="Runs the dsh agent backend that the app talks to on localhost"/>\n'
       '    </service>\n  </application>')
m = m.replace('  </application>', svc, 1)  # the base manifest's RunService already declares the FGS permissions
assert m.count('Backend') == 1 and 'extractNativeLibs' in m and 'SPECIAL_USE' in m
open('build/AndroidManifest.xml', 'w').write(m)
PY
fi
aapt2 compile --dir res -o build/res/resources.zip
aapt2 link -o build/base.apk -I "$ANDROID_JAR" --manifest "$MANIFEST" --java build/gen -A "$ASSETS" --min-sdk-version 26 --target-sdk-version 35 "${LINK[@]}" build/res/resources.zip
javac --release 17 -encoding UTF-8 -Xlint:-options -d build/classes -classpath "$ANDROID_JAR" src/dev/aum/dsha/*.java build/gen/dev/aum/dsha/R.java
d8 --lib "$ANDROID_JAR" --min-api 26 --output build/dex $(command find build/classes -name '*.class')
if [ "$FLAVOR" = standalone ]; then
  # Native libraries deflated under their ABI (extractNativeLibs=true: Android unpacks them to nativeLibraryDir).
  python - <<'PY'
import os, zipfile
with zipfile.ZipFile('build/base.apk', 'a', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in sorted(os.listdir('runtime/arm64-v8a')):
        z.write(os.path.join('runtime/arm64-v8a', f), 'lib/arm64-v8a/' + f)
PY
fi
python "$HOME/dev/mkapk.py" build/base.apk build/aligned.apk build/dex/classes*.dex
apksigner sign --ks "$HOME/dev/sdk/debug.keystore" --ks-pass pass:android --key-pass pass:android --ks-key-alias debug --out "$OUT" build/aligned.apk
apksigner verify "$OUT"
ls -lh "$OUT"
