const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

let rawEndpoint = (process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com').trim();
if (!rawEndpoint.startsWith('http://') && !rawEndpoint.startsWith('https://')) {
  rawEndpoint = `https://${rawEndpoint}`;
}

const regionMatch = rawEndpoint.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/i);
const extractedRegion = regionMatch ? regionMatch[1] : 'us-east-005';

const s3 = new S3Client({
  endpoint: rawEndpoint,
  region: extractedRegion,
  credentials: {
    accessKeyId: (process.env.B2_KEY_ID || '').trim(),
    secretAccessKey: (process.env.B2_APP_KEY || '').trim(),
  },
});

app.get('/', (req, res) => {
  res.send('CloudVault backend running.');
});

// Upload route
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const cleanName = req.file.originalname.replace(/\s+/g, '_');
    const fileKey = `${Date.now()}-${cleanName}`;
    const bucketName = (process.env.B2_BUCKET_NAME || '').trim();

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'application/octet-stream',
    });

    await s3.send(command);
    res.json({ success: true, fileKey, name: req.file.originalname, size: req.file.size });
  } catch (error) {
    console.error('B2 Upload Error:', error);
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

// Secure signed stream / download route for private B2 buckets
app.get('/api/stream/:key', async (req, res) => {
  try {
    const fileKey = req.params.key;
    const bucketName = (process.env.B2_BUCKET_NAME || '').trim();

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    });

    // Generate a temporary 1-hour signed URL
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    res.redirect(signedUrl);
  } catch (err) {
    console.error('Streaming error:', err);
    res.status(500).send('Streaming error');
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`CloudVault server running on port ${PORT}`);
});
