# SK-FDMS — Barangay Bagtic
## Sangguniang Kabataan Full Disclosure Management System

> Barangay Bagtic · Balilihan · Bohol
> DILG Full Disclosure Policy Compliant

---

## 📁 Project Structure

```
skfdms/
├── database/
│   ├── migrations/
│   │   └── 001_create_tables.sql        ← All table definitions
│   └── seeders/
│       └── 002_seed_data.sql            ← Seed categories, default admin
│
├── backend/                             ← Node.js / Express REST API
│   ├── config/
│   │   └── database.js                  ← MySQL connection pool
│   ├── controllers/
│   │   ├── AuthController.js            ← Login / logout / session
│   │   ├── DocumentController.js        ← Upload / publish / delete
│   │   ├── UserController.js            ← SK official accounts
│   │   ├── AnnouncementController.js    ← Barangay announcements
│   │   ├── ActivityLogController.js     ← Audit trail
│   │   └── CategoryController.js        ← DILG categories
│   ├── middleware/
│   │   ├── auth.js                      ← requireAuth / requireRole
│   │   └── upload.js                    ← Multer file upload config
│   ├── routes/
│   │   └── api.js                       ← All API route definitions
│   ├── utils/
│   │   └── logger.js                    ← Activity log writer
│   ├── server.js                        ← Express entry point
│   ├── package.json
│   └── .env.example                     ← Copy to .env and configure
│
└── frontend/                            ← Vanilla HTML/CSS/JS
    ├── css/
    │   └── style.css                    ← Global design system
    ├── js/
    │   └── api.js                       ← Centralized API client
    ├── index.html                       ← Public home page
    └── pages/
        ├── documents.html               ← Public document browser
        ├── about.html                   ← About the system
        ├── login.html                   ← SK official login
        └── admin/
            ├── dashboard.html           ← Admin dashboard + stats
            ├── documents.html           ← Manage / publish documents
            ├── upload.html              ← Upload new document
            ├── announcements.html       ← Post announcements
            ├── users.html               ← Manage SK official accounts
            └── activity-log.html        ← Audit trail viewer
```

---

## 🚀 Setup & Installation

### Prerequisites
- Node.js 18+
- MySQL 8+
- A web server or Live Server extension (for frontend)

### 1. Database Setup

```bash
mysql -u root -p < database/migrations/001_create_tables.sql
mysql -u root -p < database/seeders/002_seed_data.sql
```

### 2. Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env: set DB_USER, DB_PASSWORD, SESSION_SECRET

npm install
npm run dev       # Development (with nodemon)
npm start         # Production
```

Server starts at `http://localhost:3000`

### 3. Frontend Setup

Open `frontend/index.html` using:
- VS Code Live Server extension, OR
- `npx serve frontend` (serves at http://localhost:5500)

---

## 🔌 API Endpoints

### Public (No Auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/categories | List all DILG categories |
| GET | /api/documents | List published documents (filterable) |
| GET | /api/documents/:id/download | Download a document |
| GET | /api/announcements | List active announcements |

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | Login — returns session cookie |
| POST | /api/auth/logout | Logout |
| GET | /api/auth/me | Get current session user |

### Admin (Requires Auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/admin/stats | Dashboard statistics |
| GET | /api/admin/documents | List all documents (admin view) |
| POST | /api/admin/documents | Upload a document (multipart) |
| PATCH | /api/admin/documents/:id/publish | Toggle publish/unpublish |
| DELETE | /api/admin/documents/:id | Delete document (admin/chairperson) |
| GET | /api/admin/users | List SK official accounts |
| POST | /api/admin/users | Create new SK official |
| PATCH | /api/admin/users/:id/toggle | Activate/deactivate user |
| GET | /api/admin/announcements | List all announcements |
| POST | /api/admin/announcements | Post announcement |
| DELETE | /api/admin/announcements/:id | Delete announcement |
| GET | /api/admin/activity-logs | View audit trail |

---

## 👤 Default Admin Credentials

```
Email:    admin@skbagtic.gov.ph
Password: Admin@Bagtic2024
```
⚠️ **Change these immediately in production!**

---

## 🔐 Security Features

- bcrypt password hashing (12 rounds)
- Helmet.js security headers
- CSRF-safe cookie-based sessions (httpOnly, sameSite)
- Rate limiting: 100 req/15min globally, 10 login attempts/15min
- Role-based access control (admin / chairperson / treasurer / secretary)
- File type and size validation (PDF, JPG, PNG, DOC, DOCX — max 10MB)
- SQL injection prevention via parameterized queries
- Activity logging for all admin actions

---

## 📋 DILG Full Disclosure Categories

| Code | Name |
|------|------|
| AIP | Annual Investment Plan |
| SRE | Statement of Receipts and Expenditures |
| RES | SK Resolutions and Ordinances |
| PAR | Project Accomplishment Report |
| MOM | Minutes of Meetings |
| SUP | Supplemental Budget |
| ACT | Activity and Event Reports |
| ABUD | Approved SK Budget |
| UDAI | Unliquidated Cash Advances Inventory |

---

## 📍 Barangay Information

- **Barangay:** Bagtic
- **Municipality:** Balilihan
- **Province:** Bohol
- **Region:** Region VII — Central Visayas
- **Developed at:** Bohol Island State University — Balilihan Campus
