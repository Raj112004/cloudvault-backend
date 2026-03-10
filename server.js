const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use((req, res, next) => {
  res.setHeader('Connection', 'keep-alive');
  next();
});

app.use(express.json());

const s3 = new AWS.S3({
  endpoint: process.env.B2_ENDPOINT,
  accessKeyId: process.env.B2_KEY_ID,
  secretAccessKey: process.env.B2_APP_KEY,
  signatureVersion: 'v4',
  s3ForcePathStyle: true
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const upload = multer({ storage: multer.memoryStorage() });

// Generate pre-signed URL routed through Cloudflare for free unlimited bandwidth
function getSignedUrl(key) {
  return s3.getSignedUrl('getObject', {
    Bucket: process.env.B2_BUCKET,
    Key: key,
    Expires: 60 * 60 * 24
  });
}
  // Swap Backblaze domain with Cloudflare Worker domain
  return url.replace(
    `s3.us-east-005.backblazeb2.com/${process.env.B2_BUCKET}`,
    process.env.CDN_URL.replace('https://', '')
  );
}

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const key = `${uuidv4()}-${file.originalname}`;

    await s3.putObject({
      Bucket: process.env.B2_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype
    }).promise();

    const publicUrl = getSignedUrl(key);
    const shareCode = uuidv4().slice(0, 8);

    const category = file.mimetype.startsWith('video') ? 'video' :
                     file.mimetype.startsWith('image') ? 'image' :
                     file.mimetype.startsWith('audio') ? 'audio' : 'other';

    const { data, error } = await supabase.from('files').insert([{
      name: file.originalname,
      size: file.size,
      type: file.mimetype,
      category,
      r2_key: key,
      public_url: publicUrl,
      share_code: shareCode
    }]).select().single();

    if (error) throw error;
    res.json({ success: true, file: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/files', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('files')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Generate fresh signed URLs routed through Cloudflare
    const filesWithUrls = data.map(f => ({
      ...f,
      public_url: getSignedUrl(f.r2_key)
    }));

    res.json(filesWithUrls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/files/:id', async (req, res) => {
  try {
    const { data: file } = await supabase
      .from('files')
      .select('r2_key')
      .eq('id', req.params.id)
      .single();

    if (file) {
      await s3.deleteObject({
        Bucket: process.env.B2_BUCKET,
        Key: file.r2_key
      }).promise();
      await supabase.from('files').delete().eq('id', req.params.id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const server = app.listen(process.env.PORT || 3000, () =>
  console.log('CloudVault server running')
);
server.timeout = 120000;
server.keepAliveTimeout = 120000;
