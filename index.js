const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Neon Database Connection
const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_aDZQBHJX9Cq7@ep-odd-hat-aiantqny-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require',
});

// 2. Multer Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './public/uploads/';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// 3. Middleware Setup
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'premium-student-home-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } 
}));

const toArr = (val) => Array.isArray(val) ? val : (val ? [val] : []);

// 4. Database Initialization
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                full_name TEXT, phone_number TEXT, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS roommate_ads (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) UNIQUE ON DELETE CASCADE,
                apt_type TEXT, total_rooms INTEGER, total_occupants INTEGER,
                area TEXT, landmark TEXT, distance_to_campus TEXT,
                is_furnished TEXT, facilities TEXT[], roommate_share NUMERIC,
                payment_duration TEXT, light_bill_split TEXT, my_dept TEXT,
                my_sleep TEXT, my_neatness TEXT, my_personality TEXT,
                my_smoke TEXT, my_drink TEXT, pref_gender TEXT,
                pref_lifestyle TEXT, pref_occupation TEXT, description TEXT,
                images TEXT[], created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS listings (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                title TEXT, price NUMERIC, area TEXT, street TEXT,
                landmark TEXT, location TEXT, distance_to_campus TEXT,
                room_type TEXT, payment_type TEXT, num_people INTEGER DEFAULT 1,
                available_from DATE, gender_preference TEXT DEFAULT 'No preference',
                lifestyle_rules TEXT[], amenities TEXT[], description TEXT,
                image_url TEXT, image_gallery TEXT[], status TEXT DEFAULT 'Available',
                is_available_now BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS housing_requests (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                budget NUMERIC, preferred_location TEXT, description TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ Database Fully Synchronized");
    } catch (err) { console.error("❌ DB Init Error:", err); }
};
initDB();

// --- AUTH ---
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.post('/auth/register', async (req, res) => {
    const { email, password, full_name, phone_number } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query('INSERT INTO users (full_name, phone_number, email, password) VALUES ($1, $2, $3, $4) RETURNING id', [full_name, phone_number, email, hashedPassword]);
        req.session.userId = result.rows[0].id; 
        res.redirect('/dashboard');
    } catch (err) { res.status(500).send("Error: " + err.message); }
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user.id; 
        res.redirect('/dashboard');
    } else { res.send("Invalid Email/Password"); }
});

// --- DASHBOARD ---
app.get('/dashboard', async (req, res) => {
    // 1. Check if user is logged in
    if (!req.session.userId) return res.redirect('/login');

    try {
        // 2. Fetch User Info
        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
        const user = userRes.rows[0];

        // 3. Fetch Houses (listings)
        const roomsRes = await pool.query('SELECT * FROM listings WHERE user_id = $1 ORDER BY created_at DESC', [req.session.userId]);
        const rooms = roomsRes.rows;

        // 4. Fetch Roommate Ads (The missing piece!)
        const roommateRes = await pool.query('SELECT * FROM roommate_ads WHERE user_id = $1 ORDER BY created_at DESC', [req.session.userId]);
        const roommateAds = roommateRes.rows;

        // 5. Fetch Housing Requests
        const requestsRes = await pool.query('SELECT * FROM housing_requests WHERE user_id = $1 ORDER BY created_at DESC', [req.session.userId]);
        const requests = requestsRes.rows;

        // 6. Send EVERYTHING to the dashboard
        res.render('dashboard', { 
            user: user, 
            rooms: rooms, 
            roommateAds: roommateAds, // This must match the name in your EJS
            requests: requests 
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading dashboard");
    }
});

// --- LISTINGS (HOUSE) ACTIONS ---
app.get('/post-room', (req, res) => { if (!req.session.userId) return res.redirect('/login'); res.render('post-room'); });

app.post('/post-room', upload.array('images', 5), async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const b = req.body;
    const files = req.files.map(f => '/uploads/' + f.filename);
    try {
        await pool.query(`INSERT INTO listings (user_id, title, price, area, description, image_url, image_gallery, street, room_type, amenities) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [req.session.userId, b.title, b.price, b.area, b.description, files[0] || '', files, b.street, b.room_type, toArr(b.amenities)]);
        res.redirect('/dashboard');
    } catch (err) { res.send(err.message); }
});

// EDIT FORM GET
app.get('/edit-room/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const result = await pool.query('SELECT * FROM listings WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    if (result.rows.length === 0) return res.send("Not found");
    res.render('edit-room', { room: result.rows[0] });
});

// UPDATE ROOM POST (FIXED MULTIPART ERROR)
app.post('/update-room/:id', upload.array('images', 5), async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const b = req.body;
    const newFiles = req.files.map(f => '/uploads/' + f.filename);
    
    try {
        // First get existing images in case no new ones are uploaded
        const existingRes = await pool.query('SELECT image_gallery FROM listings WHERE id = $1', [req.params.id]);
        let gallery = existingRes.rows[0].image_gallery;

        // If user uploaded new photos, replace the old ones
        if (newFiles.length > 0) {
            gallery = newFiles;
        }

        const isAvailable = b.is_available_now === 'Yes';

        await pool.query(`
            UPDATE listings SET 
                title=$1, price=$2, area=$3, street=$4, 
                room_type=$5, amenities=$6, is_available_now=$7, 
                image_gallery=$8, image_url=$9
            WHERE id=$10 AND user_id=$11`, 
            [b.title, b.price, b.area, b.street, b.room_type, toArr(b.amenities), isAvailable, gallery, gallery[0] || '', req.params.id, req.session.userId]
        );
        res.redirect('/dashboard');
    } catch (err) { res.status(500).send("Update failed: " + err.message); }
});

app.post('/update-status/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    await pool.query('UPDATE listings SET status = $1 WHERE id = $2 AND user_id = $3', [req.body.status, req.params.id, req.session.userId]);
    res.redirect('/dashboard');
});

app.post('/delete-room/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    await pool.query('DELETE FROM listings WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    res.redirect('/dashboard');
});

// --- ROOMMATE ACTIONS ---
app.get('/post-roommate', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const result = await pool.query('SELECT * FROM roommate_ads WHERE user_id = $1', [req.session.userId]);
    res.render('post-roommate', { ad: result.rows[0] || null });
});

// POST: Create a NEW roommate ad
app.post('/post-roommate', upload.array('images', 5), async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const b = req.body;
    const files = req.files.map(f => '/uploads/' + f.filename);
    try {
        // Changed from "ON CONFLICT" to a standard INSERT
        await pool.query(`
            INSERT INTO roommate_ads 
            (user_id, apt_type, area, roommate_share, description, facilities, images, my_sleep, my_neatness, my_personality, pref_gender, pref_lifestyle, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Open')
        `, [req.session.userId, b.apt_type, b.area, b.roommate_share || 0, b.description, toArr(b.facilities), files, b.my_sleep, b.my_neatness, b.my_personality, b.pref_gender, b.pref_lifestyle]);
        
        res.redirect('/dashboard');
    } catch (err) { res.send(err.message); }
});


app.post('/delete-roommate-ad/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        await pool.query('DELETE FROM roommate_ads WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
        res.redirect('/dashboard');
    } catch (err) { res.status(500).send(err.message); }
});
// --- REQUESTS ACTIONS ---
app.post('/post-request', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { budget, location, description } = req.body;
    await pool.query('INSERT INTO housing_requests (user_id, budget, preferred_location, description) VALUES ($1, $2, $3, $4)', [req.session.userId, budget, location, description]);
    res.redirect('/dashboard');
});

app.post('/delete-request/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    await pool.query('DELETE FROM housing_requests WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
    res.redirect('/dashboard');
});

// --- PUBLIC VIEWS ---
app.get('/', (req, res) => res.render('index'));
app.get('/listings', async (req, res) => {
    const rooms = (await pool.query('SELECT * FROM listings WHERE status = $1 ORDER BY created_at DESC', ['Available'])).rows;
    res.render('listings', { rooms });
});
app.get('/roommates', async (req, res) => {
    try {
        // Added: WHERE status = 'Open'
        const result = await pool.query(`
            SELECT roommate_ads.*, users.full_name, users.phone_number 
            FROM roommate_ads 
            JOIN users ON roommate_ads.user_id = users.id 
            WHERE roommate_ads.status = 'Open' 
            ORDER BY created_at DESC
        `);
        res.render('roommates', { ads: result.rows });
    } catch (err) { 
        res.render('roommates', { ads: [] }); 
    }
});
// --- VIEW SINGLE ROOM DETAILS ---
app.get('/room/:id', async (req, res) => {
    try {
        const roomId = req.params.id;
        
        // Fetch room details AND the owner's info (name/phone)
        const result = await pool.query(`
            SELECT listings.*, users.full_name, users.phone_number 
            FROM listings 
            JOIN users ON listings.user_id = users.id 
            WHERE listings.id = $1
        `, [roomId]);

        if (result.rows.length === 0) {
            return res.status(404).send("Room not found");
        }

        res.render('room-details', { room: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

// --- VIEW SINGLE ROOMMATE PROFILE ---
app.get('/roommate/:id', async (req, res) => {
    try {
        const adId = req.params.id;
        const result = await pool.query(`
            SELECT roommate_ads.*, users.full_name, users.phone_number, users.email 
            FROM roommate_ads 
            JOIN users ON roommate_ads.user_id = users.id 
            WHERE roommate_ads.id = $1
        `, [adId]);

        if (result.rows.length === 0) {
            return res.status(404).send("Roommate ad not found");
        }

        res.render('roommate-details', { ad: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});
// --- TOGGLE ROOMMATE AD STATUS ---
app.post('/toggle-roommate-status/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    
    try {
        // Get current status first
        const currentAd = await pool.query(
            'SELECT status FROM roommate_ads WHERE id = $1 AND user_id = $2', 
            [req.params.id, req.session.userId]
        );

        if (currentAd.rows.length > 0) {
            const newStatus = currentAd.rows[0].status === 'Open' ? 'Closed' : 'Open';
            await pool.query(
                'UPDATE roommate_ads SET status = $1 WHERE id = $2', 
                [newStatus, req.params.id]
            );
        }
        res.redirect('/dashboard');
    } catch (err) {
        res.status(500).send(err.message);
    }
});
// --- VIEW ALL HOUSING REQUESTS ---
app.get('/requests', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT housing_requests.*, users.full_name, users.phone_number 
            FROM housing_requests 
            JOIN users ON housing_requests.user_id = users.id 
            ORDER BY housing_requests.created_at DESC
        `);

        res.render('request-board', { requests: result.rows });
    } catch (err) {
        console.error(err);
        res.render('request-board', { requests: [] });
    }
});
app.listen(PORT, () => console.log(`🚀 LIVE: http://localhost:${PORT}`));