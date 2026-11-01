#!/data/data/com.termux/files/usr/bin/bash
# DSHA Standalone runtime: builds runtime/arm64-v8a/ from Termux's installed node: Android only extracts lib/<abi>/lib*.so, so
# node becomes libnode.so, versioned sonames get flat names, every NEEDED entry is rewritten and
# RUNPATH dropped (the app sets LD_LIBRARY_PATH). Termux also bakes its sh into Node's built-in JS
# (child_process default shell); that string is swapped for /system/bin/sh, padded to the same length.
set -euo pipefail
cd "$(dirname "$0")/.."
L=runtime/arm64-v8a T=$PREFIX/lib
rm -rf "$L" && mkdir -p "$L"
declare -A MAP=( [libz.so.1]=libz1.so [libssl.so.3]=libssl3.so [libcrypto.so.3]=libcrypto3.so [libicui18n.so.78]=libicui18n78.so [libicuuc.so.78]=libicuuc78.so [libicudata.so.78]=libicudata78.so [libcares.so]=libcares.so [libsqlite3.so]=libsqlite3.so [libc++_shared.so]=libc++_shared.so )
cp -L "$(readlink -f "$PREFIX/bin/node")" $L/libnode.so
for k in "${!MAP[@]}"; do cp -L "$T/$k" "$L/${MAP[$k]}"; done
chmod u+w $L/*
for f in $L/*.so; do
  patchelf --remove-rpath "$f"
  for k in "${!MAP[@]}"; do [ "$k" != "${MAP[$k]}" ] && patchelf --replace-needed "$k" "${MAP[$k]}" "$f" 2>/dev/null || true; done
  b=$(basename "$f"); [ "$b" != libnode.so ] && patchelf --set-soname "$b" "$f"
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
echo "runtime ready: $(du -sh $L | cut -f1), node $("$L/libnode.so" -v 2>/dev/null || env -i LD_LIBRARY_PATH="$PWD/$L" "$L/libnode.so" -v)"
