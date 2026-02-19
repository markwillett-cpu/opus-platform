# Opus Platform API

A secure, production-ready REST API for the Opus Playback Class Manager. Provides controlled access to Supabase data with authentication, validation, and consistent error handling.

## Architecture

```
Frontend (HTML/JS) → Platform API (Fastify) → Supabase (PostgreSQL)
```

**Benefits:**
- 🔒 **Security**: Service role key hidden from frontend
- ✅ **Validation**: Request/response validation with Zod
- 🔑 **Authentication**: Internal API key protection
- 📝 **Consistent**: Standardized error handling and response formats
- 🚀 **Performance**: Caching and optimization opportunities
- 📊 **Monitoring**: Centralized logging and metrics

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Docker (optional, for containerized deployment)
- Supabase project with tables configured

### Local Development

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   
   Create `.env` file:
   ```env
   # Server
   PORT=8787
   NODE_ENV=development
   
   # Security
   OPUS_INTERNAL_API_KEY=your-secure-random-key-here
   
   # CORS (optional - only if frontend calls from different origin)
   CORS_ORIGIN=http://localhost:3000
   
   # Supabase
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

3. **Run server**
   ```bash
   npm run dev
   ```

4. **Test health endpoint**
   ```bash
   curl http://localhost:8787/health
   ```

### Docker Deployment

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## API Reference

All endpoints require the `X-API-Key` header (except `/health`).

### Base URL
```
http://localhost:8787/v1
```

### Authentication

Include API key in all requests:
```http
X-API-Key: your-opus-internal-api-key
```

---

### Endpoints

#### **GET /health**
Health check endpoint (no auth required).

**Response:**
```json
{ "ok": true }
```

---

#### **GET /v1/styles**
List all styles/playlists.

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Adult Rock Arrival"
    }
  ]
}
```

---

#### **GET /v1/styles/:styleId/tracks**
Get all tracks for a style with song metadata.

**Parameters:**
- `styleId` (path) - Style UUID

**Response:**
```json
{
  "data": [
    {
      "library_song_id": "uuid",
      "sim_duration_seconds": 240,
      "song": {
        "id": "uuid",
        "title": "Song Title",
        "artist": "Artist Name",
        "album": "Album Name",
        "peak_year": 2020,
        "run_time_seconds": 180,
        "styles": "Rock | Pop"
      }
    }
  ]
}
```

---

#### **GET /v1/styles/:styleId/assignments**
Get class assignments for a style.

**Parameters:**
- `styleId` (path) - Style UUID

**Response:**
```json
{
  "data": [
    {
      "library_song_id": "uuid",
      "class_code": "A",
      "moved_at": "2026-02-13T15:30:00Z"
    }
  ]
}
```

---

#### **PUT /v1/styles/:styleId/assignments**
Bulk update class assignments.

**Parameters:**
- `styleId` (path) - Style UUID

**Request Body:**
```json
{
  "assignments": [
    {
      "library_song_id": "uuid-1",
      "class_code": "A"
    },
    {
      "library_song_id": "uuid-2",
      "class_code": "B"
    }
  ]
}
```

**Response:**
```json
{
  "ok": true,
  "upserted": 2
}
```

**Validation:**
- `class_code` must be: A, B, C, or REST
- Automatically normalized to uppercase
- `moved_at` timestamp set automatically

---

#### **GET /v1/styles/:styleId/weights**
Get class weight distribution for a style.

**Parameters:**
- `styleId` (path) - Style UUID

**Response:**
```json
{
  "data": [
    { "class_code": "A", "weight_pct": 30 },
    { "class_code": "B", "weight_pct": 40 },
    { "class_code": "C", "weight_pct": 30 },
    { "class_code": "REST", "weight_pct": 0 }
  ]
}
```

---

#### **PUT /v1/styles/:styleId/weights**
Update class weight distribution.

**Parameters:**
- `styleId` (path) - Style UUID

**Request Body:**
```json
{
  "weights": [
    { "class_code": "A", "weight_pct": 35 },
    { "class_code": "B", "weight_pct": 35 },
    { "class_code": "C", "weight_pct": 30 },
    { "class_code": "REST", "weight_pct": 0 }
  ]
}
```

**Response:**
```json
{
  "ok": true,
  "upserted": 4
}
```

**Validation:**
- Weights must sum to exactly 100
- Each weight must be 0-100
- `class_code` must be valid (A, B, C, REST)

---

## Error Handling

All errors return consistent JSON format:

```json
{
  "error": {
    "message": "Error description",
    "status": 400
  }
}
```

### Common Status Codes

- `200` - Success
- `400` - Bad Request (validation failed)
- `401` - Unauthorized (missing/invalid API key)
- `500` - Internal Server Error

### Example Error Responses

**Invalid API Key:**
```json
{
  "error": {
    "message": "Unauthorized",
    "status": 401
  }
}
```

**Validation Error:**
```json
{
  "error": {
    "message": "Invalid class_code: X",
    "status": 400
  }
}
```

**Weights Don't Sum to 100:**
```json
{
  "error": {
    "message": "Weights must sum to 100. Got 95.",
    "status": 400
  }
}
```

---

## Project Structure

```
opus-api/
├── server.js                 # Main application entry
├── src/
│   ├── config.js            # Environment configuration
│   ├── auth.js              # Authentication middleware
│   ├── supabase.js          # Supabase client setup
│   ├── normalize.js         # Data normalization utilities
│   └── routes/
│       ├── styles.js        # Style list endpoint
│       ├── styleTracks.js   # Style tracks endpoint
│       ├── styleAssignments.js  # Assignment CRUD
│       └── styleWeights.js  # Weight distribution CRUD
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env                     # Environment variables (not in git)
└── README.md
```

---

## Frontend Integration

Update your frontend `config.js`:

```javascript
const OPUS_CONFIG = {
  // Use Platform API instead of direct Supabase
  API_BASE_URL: 'http://localhost:8787/v1',
  API_KEY: 'your-opus-internal-api-key',
  
  // Remove direct Supabase access
  // SUPABASE_URL: '...',  // No longer needed
  // SUPABASE_ANON_KEY: '...',  // No longer needed
  
  // Keep other config...
  MAX_TRACKS_DISPLAY: 3000,
  // ...
};
```

Example API call from frontend:

```javascript
async function fetchStyles() {
  const response = await fetch(`${OPUS_CONFIG.API_BASE_URL}/styles`, {
    headers: {
      'X-API-Key': OPUS_CONFIG.API_KEY
    }
  });
  
  const { data } = await response.json();
  return data;
}
```

---

## Security Best Practices

### Environment Variables

**Never commit `.env` to git!** Add to `.gitignore`:
```
.env
.env.*
!.env.example
```

### API Key Generation

Generate secure random keys:
```bash
# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Using OpenSSL
openssl rand -hex 32
```

### Production Checklist

- ✅ Use strong, random API keys
- ✅ Enable HTTPS/TLS
- ✅ Set `NODE_ENV=production`
- ✅ Configure proper CORS origins
- ✅ Use Supabase service role key (not anon key)
- ✅ Enable rate limiting (add Fastify rate-limit plugin)
- ✅ Set up monitoring and alerting
- ✅ Regular security updates (`npm audit`)

---

## Monitoring & Logging

Fastify provides built-in request logging. In production, consider:

**Structured Logging:**
```javascript
const app = Fastify({
  logger: {
    level: 'info',
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        headers: req.headers
      })
    }
  }
});
```

**Log Aggregation:**
- Ship logs to CloudWatch, Datadog, or similar
- Set up alerts for errors and anomalies

---

## Scaling Considerations

### Caching

Add caching for frequently accessed data:

```javascript
import { createCache } from '@fastify/cache';

await app.register(cache, {
  privacy: 'private',
  expiresIn: 300 // 5 minutes
});

app.get('/styles', {
  expireIn: 300
}, async (req, reply) => {
  // ... will be cached
});
```

### Rate Limiting

Protect against abuse:

```javascript
import rateLimit from '@fastify/rate-limit';

await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute'
});
```

### Horizontal Scaling

- Run multiple instances behind a load balancer
- Ensure stateless design (no in-memory session storage)
- Use Redis for distributed caching if needed

---

## Development Workflow

### Running Tests

```bash
# Add test command to package.json
npm test
```

### Code Quality

```bash
# Add linting
npm install -D eslint
npx eslint .

# Add formatting
npm install -D prettier
npx prettier --write .
```

### Hot Reload

For development, use nodemon:
```bash
npm install -D nodemon

# Update package.json
"scripts": {
  "dev": "nodemon server.js",
  "start": "node server.js"
}
```

---

## Deployment Options

### Docker (Recommended)

```bash
docker build -t opus-api .
docker run -p 8787:8787 --env-file .env opus-api
```

### Docker Compose

```bash
docker-compose up -d
```

### Cloud Platforms

**AWS ECS/Fargate:**
- Push to ECR
- Create ECS task definition
- Deploy to Fargate cluster

**Google Cloud Run:**
```bash
gcloud run deploy opus-api \
  --source . \
  --platform managed \
  --region us-central1
```

**Heroku:**
```bash
heroku create opus-api
git push heroku main
```

**Railway/Render:**
- Connect GitHub repository
- Auto-deploy on push

---

## Troubleshooting

### API Key Not Working

```bash
# Check if key matches
echo $OPUS_INTERNAL_API_KEY

# Test with curl
curl -H "X-API-Key: your-key" http://localhost:8787/v1/styles
```

### Supabase Connection Errors

- Verify `SUPABASE_URL` format: `https://xxx.supabase.co`
- Check service role key (not anon key)
- Ensure database tables exist
- Check Row Level Security (RLS) policies

### CORS Issues

If frontend on different domain:
```env
CORS_ORIGIN=https://your-frontend-domain.com
```

For multiple origins:
```javascript
origin: ['https://domain1.com', 'https://domain2.com']
```

---

## Roadmap

Future enhancements:

- [ ] Add request/response caching
- [ ] Implement rate limiting
- [ ] Add API versioning strategy
- [ ] Create OpenAPI/Swagger documentation
- [ ] Add automated tests (unit + integration)
- [ ] Implement request tracing (OpenTelemetry)
- [ ] Add metrics endpoint (Prometheus)
- [ ] Create database migration system
- [ ] Add webhook support for real-time updates
- [ ] Implement batch operations endpoint

---

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open Pull Request

---

## License

MIT License - see LICENSE file for details.

---

## Support

For issues or questions:
- GitHub Issues: [github.com/yourorg/opus-api/issues]
- Email: support@yourdomain.com

---

**Version**: 1.0.0  
**Last Updated**: February 2026  
**Node.js**: 18+  
**Fastify**: 4.x
