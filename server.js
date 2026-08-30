const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Support up to 2 GB single file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2048 * 1024 * 1024 }
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
  res.json({ status: 'ok', message: 'Backblaze B2 Server Working' });
});

// Primary Upload Route
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

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
    res.status(500).json({ error: error.message || 'Upload to Backblaze failed' });
  }
});

// Byte-Range Media Streaming & Download
app.get('/api/stream/:key', async (req, res) => {
  try {
    const fileKey = req.params.key;
    const bucketName = (process.env.B2_BUCKET_NAME || '').trim();

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      Range: req.headers.range,
    });

    const data = await s3.send(command);

    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Origin, Content-Type, Accept',
      'Content-Type': data.ContentType || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
    });

    if (data.ContentLength) {
      res.set('Content-Length', data.ContentLength);
    }
    if (data.ContentRange) {
      res.status(206);
      res.set('Content-Range', data.ContentRange);
    }

    data.Body.pipe(res);
  } catch (err) {
    console.error('Streaming error:', err);
    res.status(500).send('Streaming error');
  }
});

// Delete Route
app.delete('/api/delete/:key', async (req, res) => {
  try {
    const fileKey = req.params.key;
    const bucketName = (process.env.B2_BUCKET_NAME || '').trim();

    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    });

    await s3.send(command);
    res.json({ success: true, message: 'Deleted from B2' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: err.message || 'Delete failed' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`CloudVault backend running on port ${PORT}`);
});
