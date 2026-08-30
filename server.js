const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 } // 1 GB limit
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

// Authenticated Live Health Check
app.get('/api/health', async (req, res) => {
  try {
    const bucketName = (process.env.B2_BUCKET_NAME || '').trim();
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    res.json({ status: 'ok', message: 'Backblaze B2 Server Working' });
  } catch (err) {
    console.error('B2 Handshake Error:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'CloudVault Backend is online' });
});

// Upload Route (Uploads directly to Private Bucket)
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const cleanName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
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

// Authenticated Private Stream Proxy with Fallback Matcher
app.get('/api/stream', async (req, res) => {
  try {
    const rawKey = req.query.key || req.query.file;
    if (!rawKey) return res.status(400).send('Missing file key parameter');

    const fileKey = decodeURIComponent(rawKey);
    const bucketName = (process.env.B2_BUCKET_NAME || '').trim();

    const s3Params = {
      Bucket: bucketName,
      Key: fileKey,
    };

    if (req.headers.range) {
      s3Params.Range = req.headers.range;
    }

    let data;
    try {
      data = await s3.send(new GetObjectCommand(s3Params));
    } catch (primaryErr) {
      // If exact key is not found, attempt fuzzy match against existing bucket keys
      const listResp = await s3.send(new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 50 }));
      const foundItem = (listResp.Contents || []).find(item => 
        item.Key === fileKey || 
        item.Key === fileKey.replace(/\s+/g, '_') ||
        fileKey.includes(item.Key) ||
        item.Key.includes(fileKey)
      );

      if (foundItem) {
        s3Params.Key = foundItem.Key;
        data = await s3.send(new GetObjectCommand(s3Params));
      } else {
        throw new Error('Key not found in Backblaze bucket');
      }
    }

    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Origin, Content-Type, Accept',
      'Content-Type': data.ContentType || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
    });

    if (data.ContentLength) res.set('Content-Length', data.ContentLength);
    if (data.ContentRange) {
      res.status(206);
      res.set('Content-Range', data.ContentRange);
    }

    data.Body.pipe(res);
  } catch (err) {
    console.error('Private Stream Error:', err.message);
    if (!res.headersSent) {
      res.status(404).send('File not found in Backblaze bucket');
    }
  }
});

// Delete Route
app.delete('/api/delete', async (req, res) => {
  try {
    const rawKey = req.query.key;
    if (!rawKey) return res.status(400).json({ error: 'Missing key' });

    const fileKey = decodeURIComponent(rawKey);
    const bucketName = (process.env.B2_BUCKET_NAME || '').trim();

    await s3.send(new DeleteObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    }));

    res.json({ success: true, message: 'Deleted from B2' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: err.message || 'Delete failed' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`CloudVault server running on port ${PORT}`);
});
