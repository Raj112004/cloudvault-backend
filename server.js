const express = require('express');
const cors = require('cors');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();

app.use(cors());
app.use(express.json());

// S3 Client initialized for Backblaze B2
const s3 = new S3Client({
  endpoint: process.env.B2_ENDPOINT,
  region: 'us-east-005',
  credentials: {
    accessKeyId: process.env.B2_KEY_ID || '',
    secretAccessKey: process.env.B2_APP_KEY || '',
  },
});

app.get('/', (req, res) => {
  res.send('CloudVault backend is running.');
});

// Presigned URL generation for direct upload
app.post('/api/upload-url', async (req, res) => {
  try {
    const { filename, contentType } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const cleanName = filename.replace(/\s+/g, '_');
    const fileKey = `${Date.now()}-${cleanName}`;

    const command = new PutObjectCommand({
      Bucket: process.env.B2_BUCKET_NAME,
      Key: fileKey,
      ContentType: contentType || 'application/octet-stream',
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
    res.json({ uploadUrl, fileKey });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// Media Stream Redirect Route
app.get('/api/stream/:key', (req, res) => {
  const fileKey = req.params.key;
  if (process.env.CDN_URL) {
    const cdnBase = process.env.CDN_URL.replace(/\/+$/, '');
    return res.redirect(`${cdnBase}/${fileKey}`);
  }
  const endpoint = (process.env.B2_ENDPOINT || '').replace(/\/+$/, '');
  const bucket = process.env.B2_BUCKET_NAME;
  res.redirect(`${endpoint}/${bucket}/${fileKey}`);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`CloudVault server running on port ${PORT}`);
});
