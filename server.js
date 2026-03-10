const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors({
  origin: 'https://cloudvault17.netlify.app',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));
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

    const publicUrl = `${process.env.CDN_URL}/${key}`;
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
  const { data, error } = await supabase.from('files').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/files/:id', async (req, res) => {
  const { data: file } = await supabase.from('files').select('r2_key').eq('id', req.params.id).single();
  if (file) {
    await s3.deleteObject({ Bucket: process.env.B2_BUCKET, Key: file.r2_key }).promise();
    await supabase.from('files').delete().eq('id', req.params.id);
  }
  res.json({ success: true });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(3000, () => console.log('CloudVault server running on port 3000'));
