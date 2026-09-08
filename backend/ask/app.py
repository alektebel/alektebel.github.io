"""Ask-this-site backend: answers portfolio questions in Castilian Spanish or English.

Runtime: AWS Lambda (python3.12), invoked via Lambda Function URL from the
static GitHub Pages site. No third-party dependencies — stdlib only
(urllib for the LLM call, boto3 — preinstalled in the Lambda runtime —
for Secrets Manager).

Env vars (set by SAM template):
  LLM_PROVIDER   "openai" (default, OpenAI-compatible chat completions) or "anthropic"
  LLM_BASE_URL   base URL for OpenAI-compatible APIs, e.g. "https://api.nan.builders/v1"
  LLM_MODEL      model id, e.g. "qwen3.6"
  LLM_API_KEY    (optional) raw key — for local testing only
  SECRET_ARN     (preferred) Secrets Manager ARN holding {"api_key": "..."}
  ALLOWED_ORIGIN CORS origin, e.g. "https://alektebel.github.io"
"""

import json
import os
import re
import urllib.error
import urllib.request

SYSTEM = """You answer questions about Diego Rodriguez Atencia on his personal website, in his own terse first-person voice. Be direct, concrete, 2-4 sentences max, no bullet lists, no hype, never invent facts. If something isn't in the notes below, say plainly that it isn't on the site and suggest emailing dratencia@gmail.com.

LANGUAGE RULE (strict): detect the language of the user's question. If it is written in Spanish, reply entirely in Castilian Spanish (español peninsular: use "ordenador", "móvil", "vosotros" forms where natural, never Latin-American forms). If it is written in English, reply entirely in English. If mixed or unclear, default to English. Never mix languages in one answer. Keep internal reasoning minimal and output ONLY the final answer.

NOTES: Mathematician and data engineer, based in Madrid. Senior Data Analyst at PwC (2023-now): LGD database migration from SAS to Oracle for a top-5 Spanish bank, FINREP/COREP automation, stress testing. Data Engineer at Alamo Consulting (2022-2023): FINREP/COREP/SIRBE regulatory reporting for the Bank of Spain. Master's thesis on reinforcement learning, implementing Soft Actor-Critic for continuous control.
PROJECTS: deep_learning_in_c (neural net from scratch in C, backprop at the lowest level); litetorch (educational PyTorch reimplementation with RL algorithms); kan_implementation (Kolmogorov-Arnold Networks in PyTorch using Taylor expansion instead of B-splines); regllm.xyz (shipped product); an AI skill tree; convolutional nets from scratch in C.
WRITING: posts on the RL master's thesis, KANs via Taylor expansion, and a Bayesian consensus algorithm for noisy data labeling (in progress).
OPEN QUESTIONS he likes talking about: whether a decentralized civilization is feasible; what is true versus what you are told; Collatz as linear algebra; the moving-sofa problem via RL.
METHOD: owns processing pipelines end to end; debugs by disaggregating a system until each part is small enough to be obviously right or wrong; pushes systems to their physical limits and deletes the non-essential; uses AI heavily in development.
OFF-KEYBOARD: hiking, rock climbing, chess, sci-fi novels. Contact: dratencia@gmail.com, github.com/alektebel."""

_ES_WORDS = re.compile(
    r"\b(qu[eé]|c[oó]mo|por qu[eé]|cu[aá]l|cu[aá]les|d[oó]nde|est[aá]s|tienes|haces|"
    r"hablas|sobre|gracias|hola|tu|tus|est[eé]|son|para|porque|también|tiene|"
    r"hacer|trabajo|experiencia)\b",
    re.IGNORECASE,
)
_ES_CHARS = re.compile(r"[áéíóúñ¿¡ü]")


def looks_spanish(text):
    """Cheap language gate: explicit hint wins, else Spanish chars/words."""
    if _ES_CHARS.search(text):
        return True
    return bool(_ES_WORDS.search(text))


def get_api_key():
    direct = os.environ.get("LLM_API_KEY")
    if direct:
        return direct
    arn = os.environ.get("SECRET_ARN")
    if not arn:  # pragma: no cover - misconfiguration
        raise RuntimeError("No LLM_API_KEY or SECRET_ARN configured")
    import boto3  # available in the Lambda Python runtime

    sm = boto3.client("secretsmanager")
    payload = json.loads(sm.get_secret_value(SecretId=arn)["SecretString"])
    return payload["api_key"]


def _post(url, api_key, body, provider):
    # Note: api.nan.builders sits behind a bot-manager that rejects
    # scripting user-agents (Python-urllib gets a 403), so send a browser UA.
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    }
    if provider == "anthropic":
        headers["x-api-key"] = api_key
        headers["anthropic-version"] = "2023-06-01"
    else:
        headers["Authorization"] = "Bearer " + api_key
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print("llm http error:", e.code, e.read(300))
        raise


def call_anthropic(api_key, model, question, spanish):
    body = {
        "model": model,
        "max_tokens": 400,
        "system": SYSTEM
        + ("\n(The user wrote in Spanish: answer in Castilian Spanish.)"
           if spanish else "\n(The user wrote in English: answer in English.)"),
        "messages": [{"role": "user", "content": question}],
    }
    data = _post("https://api.anthropic.com/v1/messages", api_key, body, "anthropic")
    parts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    return "".join(parts).strip()


def call_openai(api_key, model, question, spanish, base_url=None):
    base = (base_url or os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")).rstrip("/")
    body = {
        "model": model,
        "max_tokens": 400,
        # qwen reasoning models dump chain-of-thought into the reply and burn
        # the token budget thinking. Per NaN docs, thinking is toggled via
        # chat_template_kwargs (top-level enable_thinking is ignored).
        "chat_template_kwargs": {"enable_thinking": False},
        "messages": [
            {"role": "system",
             "content": SYSTEM
             + ("\n(The user wrote in Spanish: answer in Castilian Spanish.)"
                if spanish else "\n(The user wrote in English: answer in English.)")},
            {"role": "user", "content": question},
        ],
    }
    data = _post(base + "/chat/completions", api_key, body, "openai")
    msg = data["choices"][0]["message"]
    # Reasoning models (e.g. qwen) sometimes put the reply in
    # reasoning_content with content=null — fall back to it, capped.
    answer = msg.get("content") or msg.get("reasoning_content") or ""
    return answer.strip()[:1200]


def _cors(origin):
    allowed = os.environ.get("ALLOWED_ORIGIN", "https://alektebel.github.io")
    return {
        "Access-Control-Allow-Origin": allowed if origin == allowed else allowed,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST",
    }


def lambda_handler(event, context):
    origin = (event.get("headers") or {}).get("origin", "")
    headers = _cors(origin)
    headers["Content-Type"] = "application/json"

    # Preflight (Function URL forwards it to us when CORS isn't managed by ALB)
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return {"statusCode": 204, "headers": headers, "body": ""}

    try:
        body = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            import base64

            body = base64.b64decode(body).decode()
        payload = json.loads(body)
        question = str(payload.get("question", "")).strip()
        if not question:
            return {"statusCode": 400, "headers": headers,
                    "body": json.dumps({"error": "question is required"})}
        question = question[:500]

        provider = os.environ.get("LLM_PROVIDER", "openai").lower()
        model = os.environ.get("LLM_MODEL", "qwen3.6")
        spanish = looks_spanish(question)
        # explicit override from the page, if ever localised: {"lang": "es"}
        if str(payload.get("lang", "")).lower().startswith("es"):
            spanish = True
        elif str(payload.get("lang", "")).lower().startswith("en"):
            spanish = False

        api_key = get_api_key()
        if provider == "openai":
            answer = call_openai(api_key, model, question, spanish)
        else:
            answer = call_anthropic(api_key, model, question, spanish)
        if not answer:
            raise RuntimeError("empty model reply")
        return {"statusCode": 200, "headers": headers,
                "body": json.dumps({"answer": answer, "lang": "es" if spanish else "en"})}
    except Exception as exc:  # never leak internals to the browser
        print("ask error:", repr(exc))
        return {"statusCode": 502, "headers": headers,
                "body": json.dumps({"error": "backend unavailable"})}
