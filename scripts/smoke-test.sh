#!/usr/bin/env bash
#
# CronPulse Smoke Test Suite
# ==========================
#
# Rapid, low-cost verification of all public endpoints.
# This is a "checking" script -- it verifies known expectations.
# It does NOT replace exploratory testing. After running this,
# spend 15 minutes manually poking around the app with a
# testing mindset: What could go wrong that these checks miss?
#
# Usage:
#   ./scripts/smoke-test.sh                   # test production
#   ./scripts/smoke-test.sh http://localhost:8787  # test local dev
#
# Exit codes:
#   0 - All tests passed
#   1 - One or more tests failed
#
# Philosophy (James Bach):
#   "A check that passes tells you one narrow thing.
#    A check that fails tells you something important.
#    Neither tells you the product is good."
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL="${1:-https://cron-pulse.com}"

# Strip trailing slash if present
BASE_URL="${BASE_URL%/}"

# Counters
PASSED=0
FAILED=0
TOTAL=0

# Timeout per request (seconds) -- fail fast, don't hang
CURL_TIMEOUT=15

# ---------------------------------------------------------------------------
# Color output helpers
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

pass() {
  PASSED=$((PASSED + 1))
  TOTAL=$((TOTAL + 1))
  echo -e "  ${GREEN}PASS${NC}  $1"
}

fail() {
  FAILED=$((FAILED + 1))
  TOTAL=$((TOTAL + 1))
  echo -e "  ${RED}FAIL${NC}  $1  ${RED}($2)${NC}"
}

section() {
  echo ""
  echo -e "${BOLD}--- $1 ---${NC}"
}

# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

# test_status <path> <expected_status> <description>
#   Sends a GET request, asserts HTTP status code.
test_status() {
  local path="$1"
  local expected="$2"
  local desc="$3"

  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time "$CURL_TIMEOUT" \
    "${BASE_URL}${path}" 2>/dev/null || echo "000")

  if [ "$actual" = "$expected" ]; then
    pass "$desc  (${actual})"
  else
    fail "$desc" "expected ${expected}, got ${actual}"
  fi
}

# test_status_and_body <path> <expected_status> <body_pattern> <description>
#   Sends a GET request, asserts HTTP status AND that the response body
#   contains a case-insensitive grep pattern.
test_status_and_body() {
  local path="$1"
  local expected="$2"
  local pattern="$3"
  local desc="$4"

  local tmpfile
  tmpfile=$(mktemp)

  local actual
  actual=$(curl -s -o "$tmpfile" -w "%{http_code}" \
    --max-time "$CURL_TIMEOUT" \
    "${BASE_URL}${path}" 2>/dev/null || echo "000")

  if [ "$actual" != "$expected" ]; then
    fail "$desc" "expected status ${expected}, got ${actual}"
    rm -f "$tmpfile"
    return
  fi

  if grep -qi "$pattern" "$tmpfile" 2>/dev/null; then
    pass "$desc  (${actual}, body contains '${pattern}')"
  else
    fail "$desc" "status OK but body missing '${pattern}'"
  fi

  rm -f "$tmpfile"
}

# test_post_status <path> <expected_status> <description> [data]
#   Sends a POST request, asserts HTTP status code.
test_post_status() {
  local path="$1"
  local expected="$2"
  local desc="$3"
  local data="${4:-}"

  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time "$CURL_TIMEOUT" \
    -X POST \
    ${data:+-d "$data"} \
    "${BASE_URL}${path}" 2>/dev/null || echo "000")

  if [ "$actual" = "$expected" ]; then
    pass "$desc  (${actual})"
  else
    fail "$desc" "expected ${expected}, got ${actual}"
  fi
}

# test_json_field <path> <expected_status> <jq_filter> <expected_value> <description>
#   Sends a GET request, asserts HTTP status AND a specific JSON field value.
test_json_field() {
  local path="$1"
  local expected="$2"
  local jq_filter="$3"
  local expected_value="$4"
  local desc="$5"

  local tmpfile
  tmpfile=$(mktemp)

  local actual
  actual=$(curl -s -o "$tmpfile" -w "%{http_code}" \
    --max-time "$CURL_TIMEOUT" \
    "${BASE_URL}${path}" 2>/dev/null || echo "000")

  if [ "$actual" != "$expected" ]; then
    fail "$desc" "expected status ${expected}, got ${actual}"
    rm -f "$tmpfile"
    return
  fi

  local field_value
  field_value=$(jq -r "$jq_filter" "$tmpfile" 2>/dev/null || echo "__jq_error__")

  if [ "$field_value" = "$expected_value" ]; then
    pass "$desc  (${actual}, ${jq_filter} = '${expected_value}')"
  else
    fail "$desc" "status OK but ${jq_filter} = '${field_value}', expected '${expected_value}'"
  fi

  rm -f "$tmpfile"
}

# ---------------------------------------------------------------------------
# Pre-flight check
# ---------------------------------------------------------------------------

echo ""
echo -e "${BOLD}CronPulse Smoke Test Suite${NC}"
echo "Target: ${BASE_URL}"
echo "Time:   $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# Verify the target is reachable at all before running 14 tests
echo ""
echo -n "Pre-flight connectivity check... "
preflight=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time "$CURL_TIMEOUT" \
  "${BASE_URL}/" 2>/dev/null || echo "000")

if [ "$preflight" = "000" ]; then
  echo -e "${RED}UNREACHABLE${NC}"
  echo "Cannot connect to ${BASE_URL}. Aborting."
  exit 1
fi
echo -e "${GREEN}OK${NC} (HTTP ${preflight})"

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

# ---- 1. Homepage ----
section "Core Pages"

test_status_and_body \
  "/" 200 "CronPulse" \
  "1. GET /              Homepage returns 200 with 'CronPulse'"

# ---- 2. Health check ----
test_json_field \
  "/health" 200 ".status" "ok" \
  "2. GET /health         Health endpoint returns JSON status 'ok'"

# ---- 3. API docs ----
test_status_and_body \
  "/docs" 200 "API" \
  "3. GET /docs           API docs page contains 'API'"

# ---- 4. Blog index ----
section "Blog"

test_status_and_body \
  "/blog" 200 "cron\|blog" \
  "4. GET /blog           Blog index contains 'blog' or 'cron'"

# ---- 5. Blog post: how-to-monitor-cron-jobs ----
test_status \
  "/blog/how-to-monitor-cron-jobs" 200 \
  "5. GET /blog/how-to-monitor-cron-jobs"

# ---- 6. Blog post: cron-job-failures ----
test_status \
  "/blog/cron-job-failures" 200 \
  "6. GET /blog/cron-job-failures"

# ---- 7. Blog post: comparison ----
test_status \
  "/blog/healthchecks-vs-cronitor-vs-cronpulse" 200 \
  "7. GET /blog/healthchecks-vs-cronitor-vs-cronpulse"

# ---- 8. Status page ----
section "Status & SEO"

test_status \
  "/status" 200 \
  "8. GET /status         Status page"

# ---- 9. robots.txt ----
test_status_and_body \
  "/robots.txt" 200 "Sitemap" \
  "9. GET /robots.txt     Contains 'Sitemap' directive"

# ---- 10. sitemap.xml ----
test_status_and_body \
  "/sitemap.xml" 200 "urlset" \
  "10. GET /sitemap.xml    Contains 'urlset' element"

# ---- 11. Auth login ----
section "Auth & API"

test_status_and_body \
  "/auth/login" 200 "login\|Login\|email\|Email" \
  "11. GET /auth/login     Login page contains 'Login' or 'email'"

# ---- 12. Ping endpoint (accepts any check ID) ----
test_post_status \
  "/ping/test-fake-id" 200 \
  "12. POST /ping/test-fake-id  Ping accepts unknown check ID"

# ---- 13. API without auth returns 401 ----
test_status \
  "/api/v1/checks" 401 \
  "13. GET /api/v1/checks  Unauthenticated returns 401"

# ---- 14. 404 for nonexistent path ----
section "Error Handling"

test_status \
  "/nonexistent-path-that-should-not-exist" 404 \
  "14. GET /nonexistent    Returns 404"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo -e "${BOLD}========================================${NC}"
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}  ALL TESTS PASSED: ${PASSED}/${TOTAL}${NC}"
else
  echo -e "${RED}${BOLD}  TESTS FAILED: ${FAILED}/${TOTAL} failed${NC}"
  echo -e "${GREEN}  Passed: ${PASSED}/${TOTAL}${NC}"
fi
echo -e "${BOLD}========================================${NC}"
echo ""

# ---------------------------------------------------------------------------
# QA Notes (for the human or agent reading this output)
# ---------------------------------------------------------------------------
# This smoke test covers the "checking" layer:
#   - Are pages reachable?
#   - Do they return expected status codes?
#   - Do responses contain expected content markers?
#
# What this does NOT cover (and you should manually explore):
#   - Actual functionality of the ping/check system end-to-end
#   - Authentication flow (login, session, logout)
#   - Dashboard rendering with real data
#   - Cron check scheduling and alerting
#   - Performance under load
#   - Mobile responsiveness
#   - Cross-browser rendering
#   - Security (XSS, CSRF, injection)
#
# Risk areas for exploratory testing (SFDPOT heuristic):
#   Structure: Do all internal links resolve? Any broken hrefs?
#   Function:  Does ping actually record a heartbeat in D1/KV?
#   Data:      What happens with very long check names? Unicode?
#   Platform:  Cloudflare Workers cold start latency?
#   Operations: What happens when D1 is slow or unavailable?
#   Time:      Do scheduled checks handle timezone edge cases?
# ---------------------------------------------------------------------------

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi

exit 0
