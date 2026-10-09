import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const BUCKET_NAME = process.env.MINIO_BUCKET || 'docvault-storage';

const minioClient = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ROOT_USER || 'admin',
    secretAccessKey: process.env.MINIO_ROOT_PASSWORD || 'password123',
  },
  forcePathStyle: true,
});

// Auto-check and create bucket if not exists
async function ensureBucket() {
  try {
    await minioClient.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') {
      await minioClient.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
      console.log(`Bucket "${BUCKET_NAME}" created successfully.`);
    }
  }
}
ensureBucket();

// 1. Upload Encrypted Binary File
app.post('/api/upload', upload.single('cipherBlob'), async (req, res) => {
  try {
    const { username, docId, mimeType } = req.body;
    if (!req.file) return res.status(400).json({ success: false, error: 'No file received' });

    const objectKey = `vaults/${username}/${docId}.enc`;

    await minioClient.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: objectKey,
      Body: req.file.buffer,
      ContentType: 'application/octet-stream',
      Metadata: { originalMime: mimeType || 'application/octet-stream' }
    }));

    res.json({ success: true, key: objectKey });
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Generate Pre-signed Download URL (Valid 10 Mins)
app.get('/api/download-url', async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ success: false, error: 'Missing object key' });

    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
    const signedUrl = await getSignedUrl(minioClient, command, { expiresIn: 600 });
    res.json({ success: true, url: signedUrl });
  } catch (err) {
    console.error('Download Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`DocVault Bridge running on http://localhost:${PORT}`));
