#!/bin/bash
SITEKEY="a5f74b19-9e45-40e0-b45d-47ff91b7a6c2"
echo "=== Testing checkcaptcha endpoints ==="
for url in \
  "https://hcaptcha.com/checkcaptcha/${SITEKEY}" \
  "https://api2.hcaptcha.com/checkcaptcha/${SITEKEY}" \
  "https://hcaptcha.com/checkcaptcha" \
  "https://api2.hcaptcha.com/checkcaptcha"; do
  echo -n "$url: "
  curl -s -o /dev/null -w "%{http_code}" -X POST "$url" -H "Content-Type: application/json" -d '{"test":"1"}'
  echo
done
