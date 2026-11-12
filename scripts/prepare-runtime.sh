#!/data/data/com.termux/files/usr/bin/bash
# DSHA Standalone runtime, into git-ignored runtime/:
# - runtime/arm64-v8a/ from Termux's installed node and proot. Android only extracts lib/<abi>/lib*.so, so node
#   becomes libnode.so, proot libproot.so, proot's static loader libproot-loader.so; versioned sonames get flat names,
#   every NEEDED entry is rewritten and RUNPATH dropped (the app sets LD_LIBRARY_PATH). Libraries whose names a Termux
#   package also ships get a libdsha- name, so that LD_LIBRARY_PATH never shadows the in-app Termux's own libraries.
#   Termux also bakes its sh into Node's built-in JS (child_process default shell); that string is swapped for
#   /system/bin/sh, padded to the same length.
# - runtime/bootstrap-aarch64.zip, the official Termux bootstrap the app unpacks at its own prefix (Termux.java).
set -euo pipefail
cd "$(dirname "$0")/.."
BOOT=https://github.com/termux/termux-packages/releases/download/bootstrap-2026.11.01-r1%2Bapt.android-7/bootstrap-aarch64.zip
L=runtime/arm64-v8a T=$PREFIX/lib
rm -rf "$L" && mkdir -p "$L"
declare -A MAP=( [libz.so.1]=libz1.so [libssl.so.3]=libssl3.so [libcrypto.so.3]=libcrypto3.so [libicui18n.so.78]=libicui18n78.so [libicuuc.so.78]=libicuuc78.so [libicudata.so.78]=libicudata78.so
  [libcares.so]=libdsha-cares.so [libsqlite3.so]=libdsha-sqlite3.so [libc++_shared.so]=libdsha-cxx.so [libtalloc.so.2]=libdsha-talloc.so [libandroid-shmem.so]=libdsha-shmem.so )
cp -L "$(readlink -f "$PREFIX/bin/node")" $L/libnode.so
cp -L "$PREFIX/bin/proot" $L/libproot.so
cp -L "$PREFIX/libexec/proot/loader" $L/libproot-loader.so
for k in "${!MAP[@]}"; do cp -L "$T/$k" "$L/${MAP[$k]}"; done
chmod u+w $L/*
for f in $L/*.so; do
  b=$(basename "$f"); [ "$b" = libproot-loader.so ] && continue # static
  patchelf --remove-rpath "$f"
  for k in "${!MAP[@]}"; do patchelf --replace-needed "$k" "${MAP[$k]}" "$f" 2>/dev/null || true; done
  case $b in libnode.so|libproot.so) ;; *) patchelf --set-soname "$b" "$f";; esac
done
# Nothing may still need a library by a name the APK doesn't carry (system libraries aside).
for f in $L/*.so; do
  for n in $(readelf -d "$f" 2>/dev/null | sed -n 's/.*NEEDED.*\[\(.*\)\]/\1/p'); do
    case $n in libc.so|libm.so|libdl.so|liblog.so) ;; *) [ -f "$L/$n" ] || { echo "$f needs $n, which is not bundled" >&2; exit 1; };; esac
  done
done
python3 - $L/libnode.so <<'PY'
import sys
p = sys.argv[1]; b = open(p, 'rb').read()
old = b"file = '/data/data/com.termux/files/usr/bin/sh';"
new = b"file = '/system/bin/sh';".ljust(len(old))
assert b.count(old) == 1, 'default-shell string not found once; check the node version'
open(p, 'wb').write(b.replace(old, new))
PY
env -i LD_LIBRARY_PATH="$PWD/$L" "$L/libnode.so" -e 'if (require("child_process").execSync("echo $0", { encoding: "utf8" }).trim() !== "/system/bin/sh") process.exit(1)'
env -i LD_LIBRARY_PATH="$PWD/$L" "$L/libproot.so" --version >/dev/null
Z=runtime/bootstrap-aarch64.zip
if [ ! -f "$Z" ]; then curl -fsSL --retry 3 -o "$Z.part" "$BOOT" && mv "$Z.part" "$Z"; fi
python3 - "$Z" <<'PY'
import sys, zipfile
n = set(zipfile.ZipFile(sys.argv[1]).namelist())
assert {'SYMLINKS.txt', 'bin/bash', 'lib/libtermux-exec-linker-ld-preload.so'} <= n, 'not a usable Termux bootstrap'
PY
echo "runtime ready: $(du -sh $L | cut -f1) libs, bootstrap $(du -h $Z | cut -f1), node $(env -i LD_LIBRARY_PATH="$PWD/$L" "$L/libnode.so" -v)"
