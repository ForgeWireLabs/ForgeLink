# Twilio Phone

A small Electron desktop client for Twilio SMS and MMS. Electron owns the UI and launches a bundled TypeScript backend as a utility process. The backend uses Node's built-in SQLite support, so packaged builds do not require Python, Node, or native database modules.

## Requirements

- Node.js 22 or newer
- A Twilio account and phone number

## Setup

```powershell
cd Electron
npm install
npm start
```

Open **Settings > Configure connection** to enter the Twilio account SID, auth token, phone number, public webhook URL, and local service address. The auth token is encrypted with Electron `safeStorage` and is never returned to the renderer.

Environment variables remain supported for development and migration:

```powershell
$env:TWILIO_ACCOUNT_SID = "AC..."
$env:TWILIO_AUTH_TOKEN = "..."
$env:TWILIO_PHONE_NUMBER = "+15551234567"
$env:TWILIO_PUBLIC_BASE_URL = "https://your-public-tunnel.example"
```

The app data is stored in `%USERPROFILE%\.twilio-phone` by default. Override it with `TWILIO_PHONE_DATA_DIR`.

For incoming messages, expose port `5055` through a secure tunnel and configure the Twilio messaging webhook as:

```text
https://your-public-tunnel.example/webhooks/sms
```

Set the delivery status callback to:

```text
https://your-public-tunnel.example/webhooks/status
```

## Development

```powershell
cd Electron
npm test
npm run dev
```

The original GTK implementation remains under `Python/TWL_phone.py` as a legacy migration reference. The supported runtime is Electron plus `Electron/backend-dist/`, built from `Electron/backend/src/`.
