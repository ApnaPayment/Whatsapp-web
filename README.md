# WhatsApp CRM

A full-stack WhatsApp Web CRM built with **Node.js**, **Express**, **whatsapp-web.js**, **Socket.io**, and **SQLite**.

## Features

- **QR-code authentication** — scan once, session persists via `LocalAuth`
- **Real-time messaging** — incoming messages pushed to UI via Socket.io
- **CRM contacts** — full CRUD with name, email, company, tags, notes
- **Chat history** — all conversations stored in SQLite
- **Send messages** — send to any WhatsApp number from the dashboard
- **Search** — full-text search across messages
- **Dark theme** UI modelled after WhatsApp Web

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and edit as needed
cp .env.example .env

# 3. Start the server
npm start
```

Open **http://localhost:3000** in your browser and scan the QR code with WhatsApp.

## Environment variables

| Variable  | Default | Description                        |
|-----------|---------|------------------------------------|
| `PORT`    | `3000`  | HTTP port                          |
| `API_KEY` | *(none)*| Optional API key for REST endpoints |

When `API_KEY` is set, all `/api/*` requests (except `/api/qr` and `/api/status`) require the header `X-API-Key: <your-key>`.

## API reference

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/status` | WhatsApp connection status |
| GET  | `/api/qr` | Current QR code (base64 PNG) |
| GET  | `/api/contacts` | List contacts |
| POST | `/api/contacts` | Create contact |
| GET  | `/api/contacts/:id` | Get contact |
| PUT  | `/api/contacts/:id` | Update contact |
| DELETE | `/api/contacts/:id` | Delete contact |
| GET  | `/api/chats` | List chats |
| GET  | `/api/chats/:chatId/messages` | Messages for a chat |
| POST | `/api/messages/send` | Send a message `{ to, body }` |
| GET  | `/api/messages/search?q=` | Search messages |

## Project structure

```
server.js               Express + Socket.io entry point
src/
  database.js           SQLite schema and query helpers
  whatsapp.js           whatsapp-web.js client, QR/message events
  middleware/auth.js    X-API-Key middleware
  routes/
    auth.js             /api/qr, /api/status (public)
    contacts.js         CRM contacts CRUD
    chats.js            Chat list + message history
    messages.js         Send message + search
public/
  index.html            Single-page dashboard
  css/style.css         Dark WhatsApp-style theme
  js/app.js             Vanilla JS frontend + Socket.io
```