import express from 'express';
import pool from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import axios from 'axios';

const router = express.Router();

// Helper to get current local date string (YYYY-MM-DD)
const getTodayDate = () => new Date().toISOString().split('T')[0];

// Geocoding Proxy to bypass CORS
router.get('/geocode', authenticateToken, async (req, res) => {
  const { lat, lng } = req.query;
  try {
    const GOOGLE_MAPS_API_KEY = "AIzaSyB6PZIFGMuRxjNTL6lJSkfLkA3qQxujGBM";
    const response = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

router.post('/punch-in', authenticateToken, async (req, res) => {
  const { lat, lng, image } = req.body;
  const userId = req.user.id;
  const today = getTodayDate();

  if (!image) {
    return res.status(400).json({ error: 'Live photo is required for punch in' });
  }

  try {
    // 1. Verify Face
    try {
      const aiUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
      const aiResponse = await axios.post(`${aiUrl}/verify`, {
        user_id: userId,
        image: image
      });
      if (!aiResponse.data.verified) {
        return res.status(401).json({ error: 'Face verification failed: ' + (aiResponse.data.message || 'Not matched') });
      }
    } catch (err) {
      console.error("Face verification API error:", err.response?.data || err.message);
      return res.status(401).json({ error: err.response?.data?.detail || 'Face verification service unavailable' });
    }

    // 2. Check if already punched in today
    const [records] = await pool.query(
      'SELECT id FROM attendance WHERE user_id = ? AND date = ?',
      [userId, today]
    );

    if (records.length > 0) {
      return res.status(400).json({ error: 'Already punched in today' });
    }

    const punchInTime = new Date();
    await pool.query(
      'INSERT INTO attendance (user_id, date, punch_in_time, location_lat, location_lng) VALUES (?, ?, ?, ?, ?)',
      [userId, today, punchInTime, lat !== undefined ? lat : null, lng !== undefined ? lng : null]
    );

    res.json({ message: 'Punch in successful', punchInTime });
  } catch (error) {
    console.error('Punch-In Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/punch-out', authenticateToken, async (req, res) => {
  const { image } = req.body;
  const userId = req.user.id;
  const today = getTodayDate();

  if (!image) {
    return res.status(400).json({ error: 'Live photo is required for punch out' });
  }

  try {
    // 1. Verify Face
    try {
      const aiUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
      const aiResponse = await axios.post(`${aiUrl}/verify`, {
        user_id: userId,
        image: image
      });
      if (!aiResponse.data.verified) {
        return res.status(401).json({ error: 'Face verification failed: ' + (aiResponse.data.message || 'Not matched') });
      }
    } catch (err) {
      console.error("Face verification API error:", err.response?.data || err.message);
      return res.status(401).json({ error: err.response?.data?.detail || 'Face verification service unavailable' });
    }

    // 2. Check if punched in
    const [records] = await pool.query(
      'SELECT id, punch_out_time FROM attendance WHERE user_id = ? AND date = ?',
      [userId, today]
    );

    if (records.length === 0) {
      return res.status(400).json({ error: 'No punch-in record found for today' });
    }

    if (records[0].punch_out_time) {
      return res.status(400).json({ error: 'Already punched out today' });
    }

    const punchOutTime = new Date();
    await pool.query(
      'UPDATE attendance SET punch_out_time = ? WHERE id = ?',
      [punchOutTime, records[0].id]
    );

    res.json({ message: 'Punch out successful', punchOutTime });
  } catch (error) {
    console.error('Punch-Out Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
