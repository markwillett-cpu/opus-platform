# Opus Playback Manager - Complete Platform

This repository contains the complete Opus Playback Manager platform with both frontend and backend components.

## 📦 What's Included

### Frontend Application (10 files)
Web-based UI for managing playback classes and track assignments.

**Core Files:**
- `config.js` - Centralized configuration
- `db-helpers.js` - Database utilities (Supabase version)
- `db-helpers-api.js` - Database utilities (API version)
- `api-client.js` - Platform API client
- `class-labels.js` - Label management system
- `index.html` - Main manager page
- `class-detail.html` - Individual class view
- `uncategorized-detail.html` - Unassigned tracks view

**Documentation:**
- `README.md` - Frontend documentation
- `API_DOCUMENTATION.md` - Complete API reference

### Backend API (13 files)
Node.js/Fastify REST API providing secure access to Supabase.

**Root Files:**
- `api-server.js` - Main application entry (rename to `server.js`)
- `api-package.json` - Dependencies (rename to `package.json`)
- `api-Dockerfile` - Docker image (rename to `Dockerfile`)
- `api-docker-compose.yml` - Docker Compose (rename to `docker-compose.yml`)
- `.env.example` - Environment template
- `.gitignore-api` - Git ignore rules (rename to `.gitignore`)

**Source Files (rename and move to `src/`):**
- `api-src-config.js` → `src/config.js`
- `api-src-auth.js` → `src/auth.js`
- `api-src-supabase.js` → `src/supabase.js`
- `api-src-normalize.js` → `src/normalize.js`

**Route Files (rename and move to `src/routes/`):**
- `api-routes-styles.js` → `src/routes/styles.js`
- `api-routes-styleTracks.js` → `src/routes/styleTracks.js`
- `api-routes-styleAssignments.js` → `src/routes/styleAssignments.js`
- `api-routes-styleWeights.js` → `src/routes/styleWeights.js`

**Documentation:**
- `opus-api-README.md` - API documentation (rename to `README.md`)
- `OPUS_API_STRUCTURE.txt` - Project structure guide

## 🏗️ Architecture

```
┌─────────────────┐
│  Frontend HTML  │ ← User Interface
│   (Browser)     │
└────────┬────────┘
         │ HTTP/REST
         ▼
┌─────────────────┐
│  Platform API   │ ← Authentication, Validation
│   (Fastify)     │
└────────┬────────┘
         │ Postgres Protocol
         ▼
┌─────────────────┐
│   Supabase      │ ← Database
│  (PostgreSQL)   │
└─────────────────┘
```

## 🚀 Deployment Options

### Option 1: Frontend Only (Direct Supabase)
**Use when:** Simple deployment, trusted users only, prototyping

1. Deploy HTML/JS files to any static host:
   - GitHub Pages
   - Netlify
   - Vercel
   - S3 + CloudFront

2. Use `db-helpers.js` (connects directly to Supabase)

3. Update `config.js` with Supabase anon key

**Pros:** Simple, fast deployment
**Cons:** Supabase anon key exposed in frontend

---

### Option 2: Full Platform (Frontend + API)
**Use when:** Production deployment, need security, want control

1. Deploy API backend:
   - Docker container (AWS ECS, GCP Cloud Run, Azure Container Apps)
   - Node.js host (Heroku, Railway, Render)
   - Kubernetes cluster

2. Deploy frontend to static host

3. Use `db-helpers-api.js` + `api-client.js`

4. Update frontend `config.js` to point to API

**Pros:** Secure (service key hidden), controlled access, monitoring
**Cons:** More infrastructure to manage

---

## 📁 Recommended Repository Structure

### Option A: Monorepo (Single Repository)
```
opus-platform/
├── frontend/          # HTML/JS application
│   ├── index.html
│   ├── config.js
│   └── ...
├── api/              # Node.js API
│   ├── server.js
│   ├── src/
│   └── ...
└── README.md         # This file
```

### Option B: Separate Repositories
```
opus-frontend/        # One repo for UI
opus-api/            # One repo for API
```

---

## 🔧 Setup Instructions

### Frontend Setup

1. **Choose deployment mode:**
   - Direct Supabase: Use `db-helpers.js`
   - Platform API: Use `db-helpers-api.js` + `api-client.js`

2. **Configure `config.js`:**
   ```javascript
   // For direct Supabase:
   SUPABASE_URL: 'https://your-project.supabase.co',
   SUPABASE_ANON_KEY: 'your-anon-key',
   
   // For Platform API:
   API_BASE_URL: 'https://your-api.com/v1',
   API_KEY: 'your-internal-key',
   ```

3. **Load correct helper in HTML:**
   ```html
   <!-- Direct Supabase -->
   <script src="db-helpers.js"></script>
   
   <!-- OR Platform API -->
   <script src="api-client.js"></script>
   <script src="db-helpers-api.js"></script>
   ```

4. **Deploy to static host**

---

### API Setup

1. **Organize files:**
   ```bash
   mkdir opus-api
   cd opus-api
   
   # Copy and rename files according to structure guide
   # See OPUS_API_STRUCTURE.txt for details
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with real credentials
   ```

3. **Install and run:**
   ```bash
   npm install
   npm run dev
   ```

4. **Deploy:**
   ```bash
   # Docker
   docker-compose up -d
   
   # Or cloud platform
   # See opus-api-README.md for deployment guides
   ```

---

## 🔐 Security Considerations

### Frontend Only Mode
- ⚠️ Supabase anon key visible in browser
- ✅ Use Row Level Security (RLS) policies
- ✅ Limit anon key permissions
- ✅ OK for internal tools with trusted users

### Platform API Mode
- ✅ Service key hidden in API backend
- ✅ API key authentication
- ✅ Request validation
- ✅ Rate limiting possible
- ✅ Recommended for production

---

## 📚 Documentation

- **Frontend README.md** - UI setup and features
- **opus-api-README.md** - API reference and deployment
- **API_DOCUMENTATION.md** - Database schema and integration
- **OPUS_API_STRUCTURE.txt** - API project organization

---

## 🛠️ Development Workflow

1. **Local development:**
   ```bash
   # API
   cd api
   npm run dev  # Runs on :8787
   
   # Frontend
   cd frontend
   python -m http.server 3000  # Or any static server
   ```

2. **Test API:**
   ```bash
   curl -H "X-API-Key: your-key" http://localhost:8787/v1/styles
   ```

3. **Open frontend:**
   ```
   http://localhost:3000
   ```

---

## 📈 Next Steps

After basic setup:

1. **Add monitoring** - Set up error tracking and metrics
2. **Implement caching** - Add Redis for frequently accessed data
3. **Rate limiting** - Protect API from abuse
4. **CI/CD** - Automate testing and deployment
5. **Documentation** - Generate OpenAPI/Swagger docs
6. **Testing** - Add unit and integration tests

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Test locally
5. Submit pull request

---

## 📄 License

MIT License - See LICENSE file

---

## 💬 Support

- GitHub Issues for bugs
- GitHub Discussions for questions
- Email: support@yourdomain.com

---

**Version:** 2.0.0  
**Last Updated:** February 2026  
**Maintainer:** Custom Channels Development Team
