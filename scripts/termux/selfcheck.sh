# DSHA Standalone self-check, run by the app through dsh's own shell path (tools.mjs sh()), so it sees exactly
# what the agent's bash tool sees. Start it from Termux or adb:
#   am start -n dev.aum.ds/dev.aum.dsha.MainActivity --ez selfcheck true
# The report lands in Download/DSHA-Standalone-check-<time>.txt.
pass=0 fail=0
check() { # check "name" command...: PASS/FAIL plus the last lines of output
  local name=$1 out; shift
  if out=$("$@" 2>&1); then pass=$((pass+1)); echo "PASS  $name"; else fail=$((fail+1)); echo "FAIL  $name (exit $?)"; fi
  [ -n "$out" ] && printf '%s\n' "$out" | tail -n 6 | sed 's/^/      /'
}
echo "shell: bash ${BASH_VERSION:-none} · PREFIX=${PREFIX:-unset} · $(/system/bin/getprop ro.product.model) Android $(/system/bin/getprop ro.build.version.release)"
[ -n "$BASH_VERSION" ] || { echo "FAIL  dsh's shell is not Termux bash; Termux setup state:"; cat ~/.dsh/termux.json 2>&1; exit 1; }
# First launch installs the base packages in the background: wait for it (up to 15 minutes).
for i in $(seq 180); do grep -q '"state": *"\(unpacking\|installing\)"' ~/.dsh/termux.json 2>/dev/null || break; sleep 5; done
check "first-run setup finished" grep -q '"state": *"ready"' ~/.dsh/termux.json
cat ~/.dsh/termux.json; echo
check "children run through termux-exec (pipes, subshells, jobs)" bash -c 'x=$(echo sub | tr a-z A-Z); (sleep 0.1; echo bg) & wait; [ "$x" = SUB ]'
check "Android's own tools" /system/bin/getprop ro.build.version.sdk
check "bundled node on PATH" node -e 'console.log(process.version, require("child_process").execSync("echo node-child").toString().trim())'
check "apt-get update" apt-get update -q
check "git" git --version
check "gh" gh --version
check "git clone over HTTPS" bash -c 'rm -rf $TMPDIR/hw && git clone -q --depth 1 https://github.com/octocat/Hello-World $TMPDIR/hw && git -C $TMPDIR/hw log --oneline -1'
check "pkg install python (a .deb repacked for this prefix)" pkg install -y python
check "python3 with ssl and HTTPS" python3 -c 'import ssl, urllib.request; print(ssl.OPENSSL_VERSION, urllib.request.urlopen("https://api.github.com", timeout=20).status)'
check "proot runs (bundled libproot.so)" proot --version
check "proot-distro install alpine" bash -c '[ -d $PREFIX/var/lib/proot-distro/installed-rootfs/alpine/etc ] || proot-distro install alpine'
check "Alpine runs under proot" proot-distro login alpine -- cat /etc/alpine-release
check "apk add inside Alpine" proot-distro login alpine -- sh -c 'apk add -q --no-progress jq && echo "{\"a\":1}" | jq .a'
check "200 process starts" bash -c 's=$(date +%s%N); for i in $(seq 200); do $PREFIX/bin/true; done; echo ms=$(( ($(date +%s%N)-s)/1000000 ))'
echo "prefix size: $(du -sh $PREFIX 2>/dev/null | cut -f1)"
echo "$pass passed, $fail failed"
[ $fail = 0 ]
