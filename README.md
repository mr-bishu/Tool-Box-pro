# ToolBox Pro 🧰

> **All-in-One File Processing Web Application**  
> Compress images, optimize PDFs, extract ZIP archives, and download YouTube audio — all in one beautiful, privacy-first platform.

![Node.js](https://img.shields.io/badge/Node.js-v24+-green?logo=node.js)
![Express](https://img.shields.io/badge/Express-4.18-blue?logo=express)
![SQLite](https://img.shields.io/badge/Database-SQLite-lightblue?logo=sqlite)
![License](https://img.shields.io/badge/License-MIT-purple)

---

## ✨ Features

| Tool | Description |
|------|-------------|
| 🖼️ **Image Compressor** | Compress JPEG, PNG, WebP, AVIF, GIF with quality control & resize |
| 📄 **PDF Compressor** | Optimize PDFs by stripping metadata and compressing structure |
| 🗜️ **ZIP Extractor** | Extract files from ZIP archives (PDFs, images, docs) |
| 🔐 **Admin Dashboard** | Monitor users, operations, and stats in real-time |

---

## 🚀 Quick Start

### Prerequisites
- Node.js v18+
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/mr-bishu/Multi-Tool-Website.git
cd Multi-Tool-Website

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Start the server
npm start
```

Open **http://localhost:3000** in your browser.

---

## 🔐 Admin Panel

Access the admin dashboard at **http://localhost:3000/admin**

**Default credentials:**
- Username: `admin`
- Password: `admin123`

> ⚠️ **Change the default password immediately after first login!**

### Admin Dashboard Features
- 📊 Real-time stats (total users, active sessions, operations count, data saved)
- 📋 Operations log with filtering by tool type
- 👥 User sessions datagram (IP, browser, OS, activity count)
- 📈 Tool usage distribution charts
- 🔑 Password management

---

## 🛡️ Security Features

- **Helmet.js** — HTTP security headers
- **Rate Limiting** — 100 req/15min general, 20 req/min for tools
- **Input Validation** — express-validator on all inputs
- **Path Traversal Prevention** — strict file path checks
- **File Type Validation** — MIME type + extension checks
- **Session Security** — httpOnly cookies, session regeneration on login
- **Auto File Cleanup** — uploaded files deleted after 1 hour
- **Timing Attack Prevention** — constant-time password comparison

---

## 📁 Project Structure

```
├── server.js              # Express main server
├── .env                   # Environment config
├── db/
│   └── database.js        # SQLite schema & queries
├── middleware/
│   └── stats.js           # Session & page view tracking
├── routes/
│   ├── tools.js           # Tool APIs (image, pdf, zip, youtube)
│   └── admin.js           # Admin auth & dashboard APIs
└── public/
    ├── index.html         # Main tool page
    ├── styles.css         # Dark glassmorphism CSS
    ├── app.js             # Frontend JavaScript
    └── admin.html         # Admin dashboard
```

---

## ⚙️ Environment Variables

```env
PORT=3000
SESSION_SECRET=your_secret_here
NODE_ENV=development
MAX_FILE_SIZE=100          # Max upload size in MB
```

---

## 🧰 Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** SQLite (better-sqlite3)
- **Image Processing:** Sharp
- **PDF Processing:** pdf-lib
- **ZIP:** unzipper
- **YouTube:** ytdl-core
- **Security:** Helmet, express-rate-limit, bcryptjs, express-validator
- **Frontend:** Vanilla HTML/CSS/JS (Dark Glassmorphism design)

---

## 📜 License

MIT © [mr-bishu](https://github.com/mr-bishu)
