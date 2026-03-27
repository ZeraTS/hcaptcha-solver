#!/bin/bash
# Test checkcaptcha with curl
SITEKEY="4c672d35-0701-42b2-88c3-78380b0db560"
VERSION="1.10.4"

# Try different endpoint formats
echo "Test 1: /checkcaptcha/{sitekey}"
curl -s -o /dev/null -w "%{http_code}" -X POST \
  "https://hcaptcha.com/checkcaptcha/${SITEKEY}" \
  -H "Content-Type: application/json" \
  -H "Origin: https://assets.hcaptcha.com" \
  -d '{"test":1}'
echo ""

echo "Test 2: /checkcaptcha/{sitekey}?v={version}"
curl -s -o /dev/null -w "%{http_code}" -X POST \
  "https://hcaptcha.com/checkcaptcha/${SITEKEY}?v=${VERSION}" \
  -H "Content-Type: application/json" \
  -H "Origin: https://assets.hcaptcha.com" \
  -d '{"test":1}'
echo ""

echo "Test 3: api2.hcaptcha.com"
curl -s -o /dev/null -w "%{http_code}" -X POST \
  "https://api2.hcaptcha.com/checkcaptcha/${SITEKEY}" \
  -H "Content-Type: application/json" \
  -H "Origin: https://assets.hcaptcha.com" \
  -d '{"test":1}'
echo ""

# Also try the getcaptcha to see full captcha key field
echo ""
echo "Test getcaptcha with proper c param:"
MOTION='{"st":1234,"dct":1234,"mm":[],"md":[],"mu":[],"v":1,"topLevel":{"st":1234,"sc":{"availWidth":1920,"availHeight":1080},"nv":{"userAgent":"Mozilla/5.0","language":"en-US","hardwareConcurrency":8,"maxTouchPoints":0,"vendor":"Google Inc."},"dr":"","exec":false,"wn":[],"xy":[],"mm":[]},"session":[],"widgetList":["0hnlmrl0mts"],"widgetId":"0hnlmrl0mts","href":"https://accounts.hcaptcha.com/","prev":{"escaped":false}}'

curl -s \
  "https://hcaptcha.com/getcaptcha/${SITEKEY}" \
  -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Origin: https://assets.hcaptcha.com" \
  --data-urlencode "v=${VERSION}" \
  --data-urlencode "sitekey=${SITEKEY}" \
  --data-urlencode "host=accounts.hcaptcha.com" \
  --data-urlencode "hl=en" \
  --data-urlencode "n=null" \
  --data-urlencode "c=null" \
  --data-urlencode "motionData=${MOTION}" | head -c 1000
echo ""
