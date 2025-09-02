import express from 'express';
import { Pool } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());
app.use(express.static('client/dist'));

// Serve DICOM files
app.get('/api/images/:sopInstanceUID', async (req, res) => {
  try {
    const { sopInstanceUID } = req.params;
    const result = await pool.query('SELECT file_path, file_name FROM images WHERE sop_instance_uid = $1', [sopInstanceUID]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Image not found' });
    }
    
    const { file_path, file_name } = result.rows[0];
    
    if (!fs.existsSync(file_path)) {
      return res.status(404).json({ message: 'Image file not found on disk' });
    }
    
    res.setHeader('Content-Type', 'application/dicom');
    res.setHeader('Content-Disposition', `inline; filename="${file_name}"`);
    
    const fileStream = fs.createReadStream(file_path);
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('Error serving DICOM file:', error);
    res.status(500).json({ message: 'Failed to serve image' });
  }
});

// Get all patients
app.get('/api/patients', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM patients ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ message: 'Failed to fetch patients' });
  }
});

// Get all studies
app.get('/api/studies', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM studies ORDER BY study_date DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching studies:', error);
    res.status(500).json({ message: 'Failed to fetch studies' });
  }
});

// Get study by ID
app.get('/api/studies/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM studies WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Study not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching study:', error);
    res.status(500).json({ message: 'Failed to fetch study' });
  }
});

// Get series by study ID
app.get('/api/studies/:id/series', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM series WHERE study_id = $1 ORDER BY series_number', [req.params.id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching series:', error);
    res.status(500).json({ message: 'Failed to fetch series' });
  }
});

// Get series by ID
app.get('/api/series/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM series WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Series not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching series:', error);
    res.status(500).json({ message: 'Failed to fetch series' });
  }
});

// Get images by series ID
app.get('/api/series/:id/images', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM images WHERE series_id = $1 ORDER BY instance_number', [req.params.id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching images:', error);
    res.status(500).json({ message: 'Failed to fetch images' });
  }
});

// Get PACS connections
app.get('/api/pacs', async (req, res) => {
  try {
    res.json([]); // No PACS connections for now
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch PACS connections' });
  }
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.resolve('client/dist/index.html'));
});

const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📊 HN-ATLAS dataset loaded with 153 CT slices`);
});