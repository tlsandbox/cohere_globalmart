# Troubleshooting Guide

## 1) Browser shows `{"detail":"Not Found"}` on a local port

Cause:
- Another local service is bound to the port you opened.

Fix:
1. Run:
   ```bash
   ./scripts/run_api_dev.sh
   ```
2. Open the exact URL printed by the script (default `http://127.0.0.1:8005`).
3. Do not assume old ports like `8000` or `8001` are this app.

## 2) Script says no free ports in 8005-8009

Cause:
- All supported demo ports are occupied.

Fix:
1. Stop existing processes on `8005..8009`.
2. Re-run `./scripts/run_api_dev.sh`.

## 3) UI shows `Failed to fetch`

Cause:
- Browser is on a different origin than the running API.

Fix:
1. Start app from one process using `./scripts/run_api_dev.sh`.
2. Use only the printed origin in browser.
3. Hard refresh (`Cmd+Shift+R`) after restarting.

## 4) AI requests timeout

Cause:
- Upstream Cohere request delay or network instability.

Fix:
1. Verify health:
   ```bash
   curl http://127.0.0.1:8005/api/health
   ```
2. Confirm `COHERE_API_KEY` is set in `.env` (or via `RN_COHERE_CONFIG_PATH`).
3. Tune `.env` values:
   - `RN_AI_SEARCH_TIMEOUT_SECONDS`
   - `RN_AI_IMAGE_TIMEOUT_SECONDS`
   - `RN_AI_REQUEST_TIMEOUT_SECONDS`
   - `RN_DENSE_BUILD_TIMEOUT_SECONDS`
4. Retry. Service should degrade gracefully to lexical/fallback behavior.

## 5) Voice search does not transcribe

Cause:
- Browser speech API unavailable, mic permission denied, or backend transcriber unavailable.

Fix:
1. Allow microphone permission for your app origin.
2. Prefer Chrome/Edge for best Web Speech API support.
3. Ensure backend dependency exists:
   ```bash
   ./.venv/bin/pip install -r requirements.txt
   ```
4. If backend fallback is slow first time, wait for Whisper model initialization.
5. If needed, continue with typed search or image upload while debugging.

## 6) First query is slower than later queries

Cause:
- Dense embedding index cache build can occur on first run.

Fix:
1. Run one warm-up query after startup.
2. Re-run search; later requests should use cached dense vectors.
3. Verify health stats include `dense_index_ready: true`.

## 7) Cart/profile modal actions fail

Cause:
- API server not running latest code or stale browser cache.

Fix:
1. Restart `./scripts/run_api_dev.sh`.
2. Hard refresh browser.
3. Check endpoints manually:
   - `GET /api/profile`
   - `GET /api/cart`
   - `POST /api/cart/add`

## 8) Language changed but text is still mixed

Cause:
- Browser cached older frontend bundles or URL missing `lang` query parameter.

Fix:
1. Use the top-right flag selector once, then refresh.
2. Confirm URL contains `lang=en|ja|zh|es`.
3. Hard refresh (`Cmd+Shift+R`) if old strings remain.
4. Verify API localization quickly:
   - `GET /api/languages`
   - `GET /api/home-products?lang=ja`

## 9) Uploaded shirt image returns mostly shoes

Cause:
- Vision analysis may output multiple article types (for example `Tshirts` and `Sports Shoes`) from one image.
- If the API process is stale, the latest article-focus guardrail is not applied.

Fix:
1. Restart API using:
   ```bash
   ./scripts/run_api_dev.sh
   ```
2. Hard-refresh the browser and re-upload the image.
3. Confirm server code is current (`search_by_image` in `service.py`) and uses primary article-type focus.
