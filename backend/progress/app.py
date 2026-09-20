"""Learn-progress backend: per-user "checks passed" for the /learn page.

Runtime: AWS Lambda (python3.12) behind an API Gateway HTTP API, same pattern
as backend/ask (Function URLs are unusable in this account). Stdlib + boto3
(preinstalled in the runtime). On-demand DynamoDB, no provisioned capacity:
at personal-site traffic this stack costs ~0/month (Lambda and HTTP API free
tiers cover it; one GetItem/UpdateItem is fractions of a cent).

Auth model — "Sign in with Google" on the client (Google Identity Services)
produces an ID token; the page sends it as `Authorization: Bearer <token>`.
We validate it server-side against Google's tokeninfo endpoint (Google checks
the JWT signature; no client secret is ever shipped anywhere) and key the
progress row by the account's stable `sub` claim. The login itself is
remembered by Google: the site keeps only the token until it expires (~1h);
after that one click on "sign in" completes instantly while the user has a
Google session.

Routes:
  GET  /progress   -> {"passed": ["aws:1", ...]} the full merged set
  PUT  /progress   body {"passed": [...]} -> union-merged server-side,
                      returns the merged set. Monotonic: only PASS is stored,
                      so progress never regresses between devices.
  GET  /           -> {"ok": true} deploy smoke test
  OPTIONS /*       -> 204 + CORS headers (CORS answered here, not by API GW)

Env vars (set by template-progress-cfn.yaml):
  GOOGLE_CLIENT_ID  OAuth web client id from console.cloud.google.com
  TABLE_NAME        DynamoDB table, partition key "sub" (S)
  ALLOWED_ORIGIN    comma-separated CORS origins
"""

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_ORIGINS = "https://diegoatencia.dev,https://www.diegoatencia.dev,https://alektebel.github.io"

ISSUERS = {"https://accounts.google.com", "accounts.google.com"}
KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}:[0-9]{1,4}$")  # "trackId:checkIndex"
MAX_KEYS = 2000
BROWSER_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

_table = None


def get_table():
    global _table
    if _table is None:
        import boto3  # preinstalled in the Lambda runtime
        _table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
    return _table


def _cors(origin):
    allowed = [
        o.strip()
        for o in os.environ.get("ALLOWED_ORIGIN", DEFAULT_ORIGINS).split(",")
        if o.strip()
    ]
    return {
        "Access-Control-Allow-Origin": origin if origin in allowed else allowed[0],
        "Vary": "Origin",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "OPTIONS,GET,PUT",
        "Access-Control-Max-Age": "86400",
        "Content-Type": "application/json",
    }


def verify_id_token(token):
    """Return claims for a valid Google ID token addressed to our client id."""
    url = "https://oauth2.googleapis.com/tokeninfo?" + urllib.parse.urlencode({"id_token": token})
    req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            claims = json.loads(resp.read().decode())
    except (urllib.error.URLError, ValueError):
        return None
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    if not client_id or claims.get("aud") != client_id:
        return None
    if claims.get("iss") not in ISSUERS:
        return None
    try:
        if float(claims.get("exp", 0)) <= time.time():
            return None
    except (TypeError, ValueError):
        return None
    if not claims.get("sub"):
        return None
    return claims


def _authed_claims(event, headers):
    raw = ""
    for k, v in (event.get("headers") or {}).items():
        if k.lower() == "authorization":
            raw = v or ""
            break
    if not raw.startswith("Bearer "):
        return None
    return verify_id_token(raw[len("Bearer "):].strip())


def _bad(headers, code, msg):
    return {"statusCode": code, "headers": headers, "body": json.dumps({"error": msg})}


def lambda_handler(event, context):
    origin = (event.get("headers") or {}).get("origin", "")
    headers = _cors(origin)
    route = (event.get("requestContext", {}).get("http", {}) or {}).get("path", "")
    method = (event.get("requestContext", {}).get("http", {}) or {}).get("method", "")

    if method == "OPTIONS":
        return {"statusCode": 204, "headers": headers, "body": ""}
    if method == "GET" and route != "/progress":
        return {"statusCode": 200, "headers": headers, "body": json.dumps({"ok": True})}

    claims = _authed_claims(event, headers)
    if not claims:
        return _bad(headers, 401, "invalid or expired Google credential")
    sub = claims["sub"]

    try:
        table = get_table()
        if method == "GET" and route == "/progress":
            item = table.get_item(Key={"sub": sub}).get("Item") or {}
            return {"statusCode": 200, "headers": headers,
                    "body": json.dumps({"passed": sorted(item.get("passed", set()))})}

        if method == "PUT" and route == "/progress":
            body = event.get("body") or "{}"
            if event.get("isBase64Encoded"):
                import base64
                body = base64.b64decode(body).decode()
            payload = json.loads(body)
            keys = payload.get("passed")
            if not isinstance(keys, list) or len(keys) > MAX_KEYS:
                return _bad(headers, 400, "passed must be a list of at most %d keys" % MAX_KEYS)
            norm = set()
            for k in keys:
                if not isinstance(k, str) or not KEY_RE.match(k):
                    return _bad(headers, 400, "bad key: %.40r" % (k,))
                norm.add(k)
            # ADD on a string set is an atomic union: two devices pushing at
            # once can only ever grow the set, never clobber each other.
            item = table.update_item(
                Key={"sub": sub},
                UpdateExpression="ADD passed :s SET updatedAt = :u, email = :e",
                ExpressionAttributeValues={
                    ":s": norm,
                    ":u": int(time.time() * 1000),
                    ":e": claims.get("email", ""),
                },
                ReturnValues="UPDATED_NEW",
            )
            merged = sorted(item.get("Attributes", {}).get("passed", norm))
            return {"statusCode": 200, "headers": headers,
                    "body": json.dumps({"passed": merged})}

        return _bad(headers, 404, "not found")
    except Exception as exc:  # never leak internals to the browser
        print("progress error:", repr(exc))
        return _bad(headers, 502, "backend unavailable")
