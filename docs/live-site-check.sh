#!/usr/bin/env bash
# Live-site checks for verslas.ai (Phase 0/1 audit).
# Run from any machine with open internet:  bash docs/live-site-check.sh > live-check.txt
# Read-only: only GET/HEAD requests, nothing is changed.
set -uo pipefail

BASE="${1:-https://verslas.ai}"
ARTICLE="${2:-/straipsniai/reklaminis-video-kaina}"

section() { printf '\n===== %s =====\n' "$1"; }

# Canonical origin after redirects (e.g. apex -> www). Later checks use it so
# they inspect the real page, not a redirect stub.
FINAL="$(curl -sSL -o /dev/null --max-time 20 -w '%{url_effective}' "$BASE/")"
FINAL="${FINAL%/}"
echo "Requested: $BASE  ->  serving origin: $FINAL"

section "Redirects and status"
for url in "$BASE/" "https://www.verslas.ai/" "http://verslas.ai/" "$BASE/straipsniai" "$BASE$ARTICLE" \
           "$BASE/robots.txt" "$BASE/sitemap.xml" "$BASE/llms.txt" "$BASE/straipsniai/rss.xml" \
           "$BASE/straipsniai/ai-klientu-aptarnavimas" "$BASE/straipsniai/ai-produktu-aprasymai"; do
  curl -sS -o /dev/null -L --max-time 20 \
    -w "%{http_code}  ${url} -> %{url_effective} (%{num_redirects} redirects)\n" "$url"
done

section "Response headers (article, final URL)"
curl -sSI --max-time 20 "$FINAL$ARTICLE" | grep -iE '^(HTTP|server|x-vercel|cf-|cache-control|content-security|x-robots|age|strict-transport)'

section "robots.txt"
curl -sS --max-time 20 "$FINAL/robots.txt"

section "sitemap.xml"
curl -sS --max-time 20 "$FINAL/sitemap.xml"

section "Article head tags"
html="$(curl -sS --max-time 20 "$FINAL$ARTICLE")"
printf '%s' "$html" | grep -oE '<title>[^<]*</title>'
printf '%s' "$html" | grep -oE '<link rel="canonical"[^>]*>'
printf '%s' "$html" | grep -oE '<meta (name|property)="(description|og:[a-z:]+|twitter:[a-z:]+|robots)"[^>]*>'
printf '%s' "$html" | grep -oE '<script type="application/ld\+json">[^<]*</script>'
printf 'Body text present in initial HTML: '
printf '%s' "$html" | grep -q 'Kas iš tikrųjų lemia kainą' && echo yes || echo NO
printf 'Sample-article marker on live site: '
curl -sS --max-time 20 "$FINAL/straipsniai/ai-klientu-aptarnavimas" | grep -q 'Pavyzdinis straipsnis' && echo "YES (placeholder is live)" || echo no

section "AI crawler user agents (see caveat in docs/PLAN.md 1.4: spoofed UAs prove blocks, not access)"
while IFS='|' read -r name ua; do
  code=$(curl -sS -o /dev/null --max-time 20 -A "$ua" -w "%{http_code}" "$FINAL$ARTICLE")
  printf '%-18s %s\n' "$name" "$code"
done <<'EOF'
Browser|Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36
Googlebot|Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)
Bingbot|Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)
Applebot|Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)
OAI-SearchBot|Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot
ChatGPT-User|Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot
GPTBot|Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot
PerplexityBot|Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot
Perplexity-User|Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user
ClaudeBot|Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +claudebot@anthropic.com
Claude-SearchBot|Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Claude-SearchBot/1.0; +https://www.anthropic.com
Claude-User|Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Claude-User/1.0; +https://www.anthropic.com
CCBot|CCBot/2.0 (https://commoncrawl.org/faq/)
EOF

section "Canonical host consistency"
canon="$(printf '%s' "$html" | grep -oE '<link rel="canonical" href="[^"]*"' | sed 's/.*href="//;s/"$//')"
echo "canonical tag: $canon"
case "$canon" in
  "$FINAL"*) echo "OK: canonical uses the serving origin" ;;
  *) echo "PROBLEM: canonical does not match the serving origin ($FINAL)"
     printf 'canonical target status: '; curl -sS -o /dev/null --max-time 20 -w '%{http_code}\n' "$canon" ;;
esac
printf 'sitemap <loc> origins: '; curl -sS --max-time 20 "$FINAL/sitemap.xml" | grep -oE '<loc>https?://[^/<]+' | sort | uniq -c | tr '\n' ' '; echo

section "DNS"
(command -v dig >/dev/null && { dig +short verslas.ai A; dig +short www.verslas.ai CNAME; dig +short verslas.ai NS; }) \
  || getent hosts verslas.ai www.verslas.ai
