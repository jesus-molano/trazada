#!/usr/bin/env bash
# Smoke post-deploy con curl: cabeceras de los datos y deep link de la app.
#   scripts/smoke-deploy.sh <URL de la app> <URL de los datos>
# Comprueba: catálogo y manifest JSON con CORS; un fichero con hash gzip, inmutable y con CORS;
# y que /replay?s=<sesión> responde 200 con HTML. (Que la página se pinta lo comprueba el e2e
# tests/e2e/deployed.spec.ts con E2E_DEPLOYED_URL.)
set -euo pipefail
APP="${1:?URL de la app}"
DATA="${2:?URL de los datos}"
APP="${APP%/}"
DATA="${DATA%/}"
fail=0

check() { # check <descripción> <cabeceras> <regex>
  if grep -qiE "$3" <<<"$2"; then echo "ok    $1"; else echo "FALLO $1 (esperaba /$3/)"; fail=1; fi
}
headers() { curl -sS -o /dev/null -D - --max-time 20 "$@"; }

cat_h=$(headers -H "Origin: $APP" "$DATA/v1/catalog.json")
check "catálogo: 200" "$cat_h" '^HTTP/[0-9.]+ 200'
check "catálogo: JSON" "$cat_h" '^content-type: application/json'
check "catálogo: CORS" "$cat_h" '^access-control-allow-origin: (\*|'"$APP"')'

catalog=$(curl -sS --max-time 20 "$DATA/v1/catalog.json")
read -r session manifest < <(node -e '
  const c = JSON.parse(require("fs").readFileSync(0, "utf8"))
  for (const s of c.seasons) for (const e of s.events) for (const x of e.sessions)
    if (x.status === "ok" && x.path && !x.dev) {
      const m = x.path.match(/^sessions\/(\d+)\/\d+-([^/]+)\/([^/]+)\/manifest\.json$/)
      console.log(`${m[1]}/${x.path.split("/")[2]}/${m[3]} ${x.path}`); process.exit(0)
    }
  process.exit(1)' <<<"$catalog") || { echo "FALLO el catálogo no tiene ninguna sesión publicada"; exit 1; }
echo "sesión: $session"

man_h=$(headers -H "Origin: $APP" "$DATA/v1/$manifest")
check "manifest: 200" "$man_h" '^HTTP/[0-9.]+ 200'
check "manifest: JSON" "$man_h" '^content-type: application/json'
check "manifest: CORS" "$man_h" '^access-control-allow-origin: '

motion=$(curl -sS --max-time 20 "$DATA/v1/$manifest" | node -e 'const m = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(m.files.motion.path)')
file_h=$(headers -H "Origin: $APP" "$DATA/v1/$(dirname "$manifest")/$motion")
check "fichero con hash: 200" "$file_h" '^HTTP/[0-9.]+ 200'
check "fichero con hash: gzip" "$file_h" '^content-type: application/gzip'
check "fichero con hash: immutable" "$file_h" '^cache-control: .*immutable'
check "fichero con hash: CORS" "$file_h" '^access-control-allow-origin: '

app_h=$(headers "$APP/replay?s=$session")
check "deep link /replay?s=$session: 200" "$app_h" '^HTTP/[0-9.]+ 200'
check "deep link: HTML" "$app_h" '^content-type: text/html'

exit $fail
