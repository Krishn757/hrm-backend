import express from 'express';
import bcrypt from 'bcrypt';
import pool from '../db.js';
import { authenticateToken, verifyAdmin } from '../middleware/auth.js';
import axios from 'axios';

const router = express.Router();

// Route strictly for Admins to create new employees
router.post('/create-employee', authenticateToken, verifyAdmin, async (req, res) => {
  const { email, password, image } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
      [email, passwordHash, 'employee']
    );

    const newUserId = result.insertId;

    // Call Python AI API if image is provided
    if (image) {
      try {
        const aiResponse = await axios.post('http://localhost:8000/register', {
          user_id: newUserId,
          image: image
        });

        if (aiResponse.data.success) {
          await pool.query('UPDATE users SET face_registered = 1 WHERE id = ?', [newUserId]);
        }
      } catch (err) {
        console.error("Face registration failed:", err.response?.data || err.message);
        return res.status(201).json({
          message: 'Employee created, but face registration failed. The image might not contain a clear face.',
          employeeId: newUserId,
          error: err.response?.data?.detail || err.message
        });
      }
    }

    res.status(201).json({
      message: 'Employee created successfully',
      employeeId: newUserId
    });

  } catch (error) {
    console.error('Create Employee Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin fetching all employees
router.get('/employees', authenticateToken, verifyAdmin, async (req, res) => {
  try {
    const [employees] = await pool.query('SELECT id, email, face_registered, created_at FROM users WHERE role = ?', ['employee']);
    res.json({ employees });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
