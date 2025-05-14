const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bcrypt = require('bcrypt');
const mysql = require('mysql');
const session = require('express-session');

const app = express();
const PORT = 3000;

// 1️⃣ CORRECT CORS middleware — must come BEFORE session
app.use(cors({
  origin: ['http://127.0.0.1:5500', 'http://localhost:5500'],
  credentials: true
}));

// 2️⃣ Parse incoming JSON
app.use(express.json());

app.use(session({
  name: 'connect.sid',
  secret: process.env.SECRET_KEY,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,  // false for local development (use true for HTTPS)
    sameSite: 'lax',  // helps with cross-origin requests
    domain: '.localhost'  // Allow the cookie to be shared across ports (both 3000 and 5500)
  }
}));


// Create DB connection
const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: proccess.env.DB_PASSWORD, // or your actual MySQL password
  database: process.env.DB_NAME // replace with your actual DB name
});

// Connect to DB
db.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err.message);
  } else {
    console.log('Connected to MySQL database.');
  }
});

app.get('/check-session', (req, res) => {
  if (req.session.user) {
    res.status(200).json({ loggedIn: true, user: req.session.user });
  } else {
    res.status(401).json({ loggedIn: false });
  }
});

app.get('/user-info', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.json(req.session.user);
});

app.post('/update-profile', async (req, res) => {
  const { email, contact } = req.body;
  const userId = req.session.user?.id;

  if (!userId) {
    return res.status(401).send('Not authenticated');
  }

  try {
    const query = 'UPDATE users SET email = ?, contact = ? WHERE id = ?';
    db.query(query, [email, contact, userId], (err, result) => {
      if (err) {
        console.error('Update error:', err);
        return res.status(500).send('Server error');
      }

      console.log('Update result:', result);

      // Update the session data with the new email and contact
      req.session.user.email = email;
      req.session.user.contact = contact;

      // Preserve first_name, last_name, and user_position in the session
      // No need to re-fetch from DB for these values since they are in the session already
      req.session.user.first_name = req.session.user.first_name || 'Default FirstName';  // Ensure it remains
      req.session.user.last_name = req.session.user.last_name || 'Default LastName';  // Ensure it remains
      req.session.user.user_position = req.session.user.user_position || 'Default Position';  // Ensure it remains

      // Save session explicitly
      req.session.save((err) => {
        if (err) {
          console.error('Error saving session:', err);
        }
        res.send('Profile updated successfully');
      });
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).send('Unexpected server error');
  }
});

app.delete('/delete-account', (req, res) => {
  const userId = req.session.user?.id;

  if (!userId) {
    return res.status(401).send('Not authenticated');
  }

  const query = 'DELETE FROM users WHERE id = ?';

  db.query(query, [userId], (err, result) => {
    if (err) {
      console.error('Delete error:', err);
      return res.status(500).send('Server error');
    }

    req.session.destroy(err => {
      if (err) {
        console.error('Session destroy error:', err);
        return res.status(500).send('Logout failed');
      }

      res.send('Account deleted successfully');
    });
  });
});


app.post('/login', (req, res) => {
  console.log('Received login request:', req.body);
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).send("Username and password are required.");
  }

  const sql = 'SELECT * FROM users WHERE username = ?';

  db.query(sql, [username], (err, result) => {
    if (err) {
      console.error("Database query error:", err);
      return res.status(500).send("Error logging in.");
    }

    if (result.length === 0) {
      return res.status(400).send("User not found.");
    }

    const user = result[0];

    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) {
        console.error("Bcrypt error:", err);
        return res.status(500).send("Error checking password.");
      }

      if (!isMatch) {
        console.error("Incorrect password for user:", username);
        return res.status(400).send("Incorrect password.");
      }

      // ✅ Store expected field names in session
      req.session.user = {
        id: user.id,
        username: user.username,
        email: user.email,
        contact: user.contact,
        first_name: user.first_name,
        last_name: user.last_name,
        user_position: user.user_position,
        farm_address: user.farm_address,
        farm_owner: user.farm_owner,
        organization: user.organization,
        farm_name: user.farm_name
      };

      console.log('Session user data:', req.session.user);
      res.status(200).send("Login successful!");
    });
  });
});


app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.log('Logout error:', err);
      return res.status(500).send('Logout failed.');
    }
    res.clearCookie('connect.sid');
    console.log('User logged out successfully');
    res.send('Logged out successfully');
  });
});

app.post('/signup', (req, res) => {
  const { firstName, lastName, username, contact, email, password, confirmPassword, farmOwner, userPosition, orgName, farmName, farmAddress } = req.body;

  if (password !== confirmPassword) {
      return res.status(400).send("Passwords do not match");
  }

  const hashedPassword = bcrypt.hashSync(password, 10);

  const sql = `
      INSERT INTO users (first_name, last_name, username, contact, email, password, farm_owner, user_position, organization, farm_name, farm_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(sql, [firstName, lastName, username, contact, email, hashedPassword, farmOwner, userPosition, orgName, farmName, farmAddress], (err, result) => {
      if (err) {
          console.error(err);
          return res.status(500).send("Error registering user.");
      }
      res.status(200).send("Signup successful!");
  });
});

const GROQ_API_KEY = process.env.GROQ_API_KEY; // Replace with your actual key

app.post('/ai-suggestions', async (req, res) => {
  const { zinc, npk, moisture, temperature } = req.body;

  const prompt = `Given this simulated soil data:
- Zinc level: ${zinc}
- NPK level: ${npk}
- Moisture: ${moisture}%
- Temperature: ${temperature}°C

Suggest 2-3 best actions a farmer should take to improve soil health. Respond with just the suggestions as a list.`;

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama3-8b-8192',
        messages: [
          { role: 'system', content: 'You are a helpful AI soil expert.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const aiText = response.data.choices[0].message.content;
    const suggestions = aiText.split('\n').filter(line => line.trim().length > 0);

    res.json({ suggestions });
  } catch (error) {
    console.error('Error fetching Groq API:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to get AI suggestions.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

