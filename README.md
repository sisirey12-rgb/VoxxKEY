<div align="center">

# 🔐 VOXX License Server

### Secure • Lightweight • Production-Ready License Management

A modern backend API for managing APK licenses — **generate, activate, validate, reset HWID, extend, regenerate, and revoke** from one centralized service.

<br>

![Node](https://img.shields.io/badge/Node.js-%3E%3D16-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Status](https://img.shields.io/badge/Status-Active-22c55e?style=for-the-badge)
![API](https://img.shields.io/badge/API-REST-6366f1?style=for-the-badge)
![Database](https://img.shields.io/badge/Database-Turso-111827?style=for-the-badge)
![License](https://img.shields.io/badge/License-Private-6b7280?style=for-the-badge)

<br>

**Built for secure APK licensing, device binding, administration, and reseller distribution.**

</div>

---

## ✨ What is VOXX?

**VOXX License Server** is a centralized license-management backend designed for Android applications and their distribution partners.

It provides a simple REST API for validating licenses at app launch while giving administrators and resellers controlled tools for managing keys.

### Core capabilities

| 🔑 Licensing | 🛡️ Security | 🤝 Resellers |
|---|---|---|
| Generate keys | Admin authentication | Partner tokens |
| Activate licenses | Login lockouts | Credit balances |
| Validate licenses | Optional TOTP 2FA | Tiered pricing |
| Reset HWID | Audit logging | Sales history |
| Extend licenses | Secure sessions | Top-up requests |
| Revoke licenses | HTTP-only cookies | Scoped access |

---

# 🧩 Architecture

```text
                         ┌──────────────────────┐
                         │      Android APK     │
                         │                      │
                         │  License Key + HWID  │
                         └───────────┬──────────┘
                                     │
                                     │ HTTPS
                                     ▼
                    ┌────────────────────────────────┐
                    │       VOXX LICENSE SERVER      │
                    │                                │
                    │        Node.js + Express       │
                    └───────────────┬────────────────┘
                                    │
                ┌───────────────────┼───────────────────┐
                │                   │                   │
                ▼                   ▼                   ▼
        ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
        │   License    │    │    Admin     │    │   Reseller   │
        │     API      │    │     API      │    │     API      │
        └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
               │                   │                   │
               └───────────────────┼───────────────────┘
                                   ▼
                         ┌──────────────────┐
                         │   Turso Database │
                         └──────────────────┘
```

---

# 🚀 Features

## 🔑 License Management

- Generate license keys with configurable validity
- Set maximum device limits
- Activate licenses on first use
- Validate licenses on every app launch
- Reset HWID bindings
- Extend license validity
- Regenerate keys
- Revoke licenses
- Track license state and metadata

## 📱 HWID Device Binding

A license can be bound to a device through its HWID.

```text
License Key
     │
     ├── Status
     ├── Expiration
     ├── HWID
     ├── Device Limit
     └── Metadata
```

This allows the server to control how many devices can use a license.

---

# 🛡️ Admin Security Add-On

VOXX includes an optional hardened admin authentication layer designed to replace raw admin-key authentication in the browser.

### Security features

- 🔐 bcrypt password authentication
- 🚫 Username lockout after 5 failed attempts
- 🌐 Independent IP-based lockout
- 🔑 Optional TOTP 2FA
- 📱 Google Authenticator / Authy compatible
- 🍪 HttpOnly + Secure + SameSite=Strict session cookies
- ⏱️ 15-minute sliding session expiry
- 📋 Authentication audit logging
- 🔄 Logout/session management

> **Important:** Keep all server credentials and secrets on the server. Never embed production secrets in frontend JavaScript.

---

# 📦 Security Add-On Files

Drop the following into your existing VOXX License Server repository:

```text
sql/002_auth_security.sql
create-admin.js
middleware/security.js
middleware/authSession.js
routes/auth.js
SERVER_INTEGRATION.md
frontend-login-snippet.html
```

### What each file does

| File | Purpose |
|---|---|
| `002_auth_security.sql` | Database migration for authentication security |
| `create-admin.js` | Creates an admin account |
| `security.js` | Lockout tracking + audit helpers |
| `authSession.js` | Secure session cookie creation/validation |
| `auth.js` | Login, logout, session, and 2FA endpoints |
| `SERVER_INTEGRATION.md` | Server integration instructions |
| `frontend-login-snippet.html` | Admin login UI + API integration |

---

# ⚙️ Security Add-On Setup

### 1. Install dependencies

```bash
npm install bcrypt cookie-parser speakeasy qrcode
```

### 2. Run the database migration

Run:

```text
sql/002_auth_security.sql
```

against your Turso database **once**.

### 3. Add the middleware and routes

Copy the security files into the paths shown above.

### 4. Follow the integration guide

Use:

```text
SERVER_INTEGRATION.md
```

to wire the authentication routes into `server.js`.

### 5. Create your admin account

```bash
node create-admin.js <username> <password>
```

### 6. Update the admin frontend

Merge:

```text
frontend-login-snippet.html
```

into your admin interface according to its included instructions.

### 7. Deploy

After deployment, remove or rotate any legacy `ADMIN_KEY` usage from the browser side.

---

# 📡 API Reference

## Public Endpoints

These endpoints are intended for your Android application.

| Method | Endpoint | Body | Purpose |
|:---:|---|---|---|
| `POST` | `/api/activate` | `{ license_key, hwid }` | Bind a license on first activation |
| `POST` | `/api/validate` | `{ license_key, hwid }` | Validate a license |

### Example — Activate

```http
POST /api/activate
Content-Type: application/json
```

```json
{
  "license_key": "XXXX-XXXX-XXXX",
  "hwid": "ANDROID-HWID"
}
```

### Example — Validate

```http
POST /api/validate
Content-Type: application/json
```

```json
{
  "license_key": "XXXX-XXXX-XXXX",
  "hwid": "ANDROID-HWID"
}
```

---

# 👑 Admin API

> Legacy admin endpoints use `X-Admin-Key`. If you enable the security add-on, migrate browser administration to the authenticated session flow described above.

| Method | Endpoint | Body | Description |
|:---:|---|---|---|
| `GET` | `/admin/keys` | — | List license keys |
| `POST` | `/admin/generate-key` | `{ validity_days, max_devices, label }` | Generate a key |
| `POST` | `/admin/reset-hwid` | `{ license_key }` | Reset device binding |

Additional management operations can include:

```text
Extend
Regenerate
Revoke
```

Refer to the implementation in the repository for the complete route list.

---

# 🤝 Reseller API

Reseller requests use:

```http
X-Reseller-Token: <partner-token>
```

Each reseller token is scoped to its own partner account.

| Method | Endpoint | Description |
|:---:|---|---|
| `GET` | `/reseller/me` | Partner profile + credits |
| `GET` | `/reseller/pricing` | Current pricing table |
| `POST` | `/reseller/generate-key` | Generate a license |
| `GET` | `/reseller/sales` | View generated keys |
| `POST` | `/reseller/topup-request` | Request credit top-up |
| `GET` | `/reseller/topups` | View top-up history |

---

# 💳 Reseller Pricing

| Validity | Cost |
|:---:|---:|
| `1 day` | `0.5 credits` |
| `3 days` | `1.0 credits` |
| `7 days` | `2.0 credits` |
| `15 days` | `3.5 credits` |
| `30 days` | `6.0 credits` |

> Reseller `validity_days` must match an available pricing tier. Arbitrary durations are rejected.

Resellers cannot choose custom license strings; generated keys use the server's standard format.

---

# 🏗️ Project Structure

```text
VOXX-License-Server/
│
├── server.js
├── package.json
├── .env.example
├── README.md
│
├── routes/
│   ├── license.js
│   ├── admin.js
│   ├── reseller.js
│   └── auth.js
│
├── middleware/
│   ├── security.js
│   ├── authSession.js
│   └── licenseProtection.js
│
├── sql/
│   └── 002_auth_security.sql
│
├── create-admin.js
├── SERVER_INTEGRATION.md
└── frontend-login-snippet.html
```

---

# 🚀 Quick Start

```bash
git clone YOUR_REPOSITORY_URL
cd VOXX-License-Server

npm install

cp .env.example .env

# Configure your environment
npm start
```

Default local address:

```text
http://localhost:3000
```

---

# 🔧 Environment

Example:

```env
PORT=3000
DATABASE_URL=YOUR_TURSO_DATABASE_URL
```

Add all required production secrets to your hosting provider's environment-variable settings.

### Never commit

```text
.env
database credentials
admin passwords
reseller tokens
private API secrets
production session secrets
```

---

# 🌍 Deployment

VOXX is designed to run as a single Node.js service.

```text
GitHub
   │
   ▼
Deployment Platform
   │
   ▼
Node.js / Express
   │
   ├── License API
   ├── Admin API
   ├── Auth API
   └── Reseller API
           │
           ▼
        Turso DB
```

### Production checklist

- [ ] Configure environment variables
- [ ] Configure Turso database
- [ ] Run required SQL migrations
- [ ] Create admin account
- [ ] Enable HTTPS
- [ ] Configure CORS
- [ ] Configure rate limiting
- [ ] Verify `/api/activate`
- [ ] Verify `/api/validate`
- [ ] Verify admin login
- [ ] Test 2FA if enabled
- [ ] Remove legacy browser `ADMIN_KEY` usage

---

# 🔐 Security Notes

### Protect `ADMIN_KEY`

If legacy admin-key authentication remains enabled:

```text
X-Admin-Key: <ADMIN_KEY>
```

Treat it like a password.

Use a long, random value and keep it outside version control.

### Reseller tokens

Reseller tokens are separate from `ADMIN_KEY`.

Each token is scoped to one partner account and should only permit access to that partner's resources.

### HTTPS

Do not expose authentication or license APIs over plain HTTP in production.

Use HTTPS for all production traffic.

---

# 🧪 Example License Flow

```text
             User enters license
                     │
                     ▼
              POST /activate
                     │
          ┌──────────┴──────────┐
          │                     │
       Valid                 Invalid
          │                     │
          ▼                     ▼
     Bind HWID               Reject
          │
          ▼
       App Launch
          │
          ▼
       /validate
          │
     ┌────┴────┐
     │         │
   Valid    Invalid
     │         │
     ▼         ▼
  Continue   Block
```

---

# 🛠️ Troubleshooting

### `License invalid`

Check:

- License key
- License status
- Expiration
- HWID
- Device limit
- Database connection

### `Request authentication failed`

Check that the client and server authentication configuration match and that required authentication/session data is being supplied.

### `This browser is not bound to this license`

The license may already be bound to another device, or activation has not completed.

### `Too many requests`

Rate limiting has been triggered. Wait before retrying.

---

# 📞 Support & Contact

<div align="center">

### ⚡ YORVOXX H4X

**Telegram Channel**

https://t.me/yorxvox

**Developer / Support**

`@yor_forg3r`

</div>

---

# 📄 License

**Private / Internal Use**

This project is intended for authorized software licensing and distribution.

Do not use the service to manage licenses for software, systems, or resources you do not own or have permission to administer.

---

<div align="center">

### 🔐 VOXX

**LICENSE • SECURITY • CONTROL**

Made for the YORVOXX ecosystem.

</div>
