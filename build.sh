#!/data/data/com.termux/files/usr/bin/bash
# No-Gradle build (recipe A in ~/android-dev/TOOLCHAIN.md). Writes dsha.apk.
set -euo pipefail
cd "$(dirname "$0")"
ANDROID_JAR="$HOME/dev/sdk/android.jar"
rm -rf build && mkdir -p build/{res,gen,classes,dex}
aapt2 compile --dir res -o build/res/resources.zip
aapt2 link -o build/base.apk -I "$ANDROID_JAR" --manifest AndroidManifest.xml --java build/gen -A assets --min-sdk-version 26 --target-sdk-version 35 build/res/resources.zip
javac --release 17 -encoding UTF-8 -Xlint:-options -d build/classes -classpath "$ANDROID_JAR" src/dev/aum/dsha/*.java build/gen/dev/aum/dsha/R.java
d8 --lib "$ANDROID_JAR" --min-api 26 --output build/dex $(command find build/classes -name '*.class')
python "$HOME/dev/mkapk.py" build/base.apk build/aligned.apk build/dex/classes*.dex
apksigner sign --ks "$HOME/dev/sdk/debug.keystore" --ks-pass pass:android --key-pass pass:android --ks-key-alias debug --out dsha.apk build/aligned.apk
apksigner verify dsha.apk
ls -lh dsha.apk
