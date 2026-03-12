require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const envelopeRoutes = require('./routes/envelopes');
const signRoutes = require('./routes/sign');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Trust Nginx reverse proxy
if (isProduction) {
  app.set('trust proxy', 1);
}

// Ensure upload directory exists
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// CORS — allow external frontends (e.g. Lovable) to connect
if (process.env.CORS_ORIGIN) {
  app.use(cors({
    origin: process.env.CORS_ORIGIN.split(',').map(s => s.trim()),
    credentials: true
  }));
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'esignature-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: isProduction,
    sameSite: 'lax'
  }
}));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/envelopes', envelopeRoutes);
app.use('/api/sign', signRoutes);
app.use('/api/admin', adminRoutes);

// Serve the main app for any non-API route
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`BuyerForesight eSign running at http://localhost:${PORT}`);
});

module.exports = app;
