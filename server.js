const express = require('express');
const cors = require('cors');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['*']
}));
app.use(express.json());

let rawEndpoint = (process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com').trim();
if (!rawEndpoint.startsWith('http://') && !rawEndpoint.startsWith('https://')) {
  rawEndpoint = `https://${rawEndpoint}`;
}

const regionMatch = rawEndpoint.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/i);
const extractedRegion = regionMatch ? regionMatch[1] : 'us-east-005';

// forcePathStyle: true ensures Backblaze receives path-style requests
const s3 = new S3Client({
  endpoint: rawEndpoint,
  region: extractedRegion,
  forcePathStyle: true,
  credentials: {
    accessKeyId: (process.env.B2_KEY_ID || '').trim(),
    secretAccessKey: (process.env.B2_APP_KEY || '').trim(),
  },
});

app.get('/', (req, res) => {
  res.send('CloudVault backend is running.');
});

// Presigned Upload Route
app.post('/api/upload-url', async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const bucketName = (process.env.B2_BUCKET_NAME || '').trim();
    if (!bucketName) {
      throw new Error('B2_BUCKET_NAME is missing in environment variables');
    }

    const cleanName = filename.replace(/\s+/g, '_');
    const fileKey = `${Date.now()}-${cleanName}`;

    // Do NOT lock ContentType in the command signature to avoid B2 CORS preflight header mismatches
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
    res.json({ uploadUrl, fileKey });
  } catch (error) {
    console.error('Error generating presigned URL:', error.message || error);
    res.status(500).json({ error: error.message || 'Failed to generate upload URL' });
  }
});

// Stream Route
app.get('/api/stream/:key', (req, res) => {
  const fileKey = req.params.key;
  if (process.env.CDN_URL) {
    const cdnBase = process.env.CDN_URL.replace(/\/+$/, '');
    return res.redirect(`${cdnBase}/${fileKey}`);
  }
  const endpoint = rawEndpoint.replace(/\/+$/, '');
  const bucket = (process.env.B2_BUCKET_NAME || '').trim();
  res.redirect(`${endpoint}/${bucket}/${fileKey}`);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`CloudVault server running on port ${PORT}`);
});
