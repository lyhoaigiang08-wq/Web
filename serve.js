const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Khởi tạo cơ sở dữ liệu SQL (SQLite - Lưu trữ vào tệp database.sqlite)
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('Lỗi kết nối cơ sở dữ liệu SQL:', err);
    else console.log('Đã kết nối thành công đến cơ sở dữ liệu SQL.');
});

// Khởi tạo các bảng SQL
db.serialize(() => {
    // Bảng tài khoản người dùng
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        fullName TEXT,
        phone TEXT,
        earnings REAL DEFAULT 0,
        isAdmin INTEGER DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Bảng danh sách link
    db.run(`CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT,
        reward REAL,
        remaining INTEGER
    )`);

    // Bảng lịch sử vượt link
    db.run(`CREATE TABLE IF NOT EXISTS link_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER,
        linkId INTEGER,
        passedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Bảng tin nhắn chat
    db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT,
        text TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tạo sẵn tài khoản Admin bí mật (Chỉ người quản trị biết)
    db.run(`INSERT OR IGNORE INTO users (id, username, password, fullName, phone, isAdmin) 
            VALUES (1, 'admin_bi_mat', 'MatKhauGiau123@#', 'Quản Trị Viên', '0999999999', 1)`);
});

// 1. API Đăng ký
app.post('/api/register', (req, res) => {
    const { username, password, fullName, phone } = req.body;
    db.run(`INSERT INTO users (username, password, fullName, phone) VALUES (?, ?, ?, ?)`,
        [username, password, fullName, phone],
        function (err) {
            if (err) return res.status(400).json({ message: 'Tên tài khoản đã tồn tại!' });
            res.json({ message: 'Đăng ký thành công', userId: this.lastID });
        }
    );
});

// 2. API Đăng nhập
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT id, username, fullName, phone, earnings, isAdmin FROM users WHERE username = ? AND password = ?`,
        [username, password],
        (err, user) => {
            if (err || !user) return res.status(400).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng!' });
            res.json({ user });
        }
    );
});

// 3. API Thống kê cá nhân
app.get('/api/user/stats/:userId', (req, res) => {
    const userId = req.params.userId;
    db.get(`SELECT earnings FROM users WHERE id = ?`, [userId], (err, user) => {
        db.get(`SELECT COUNT(*) as passedCount FROM link_history WHERE userId = ?`, [userId], (err, history) => {
            db.get(`SELECT SUM(remaining) as remainingLinks FROM links`, [], (err, links) => {
                res.json({
                    earnings: user ? user.earnings : 0,
                    passedLinks: history ? history.passedCount : 0,
                    remainingLinks: links ? (links.remainingLinks || 0) : 0
                });
            });
        });
    });
});

// 4. API Lấy danh sách link khả dụng
app.get('/api/links', (req, res) => {
    db.all(`SELECT * FROM links WHERE remaining > 0`, [], (err, rows) => {
        res.json(rows || []);
    });
});

// 5. API Vượt link
app.post('/api/pass-link', (req, res) => {
    const { userId, linkId } = req.body;
    db.get(`SELECT * FROM links WHERE id = ? AND remaining > 0`, [linkId], (err, link) => {
        if (!link) return res.status(400).json({ message: 'Link không tồn tại hoặc đã hết lượt!' });

        // Cập nhật lượt còn lại & tiền thưởng
        db.run(`UPDATE links SET remaining = remaining - 1 WHERE id = ?`, [linkId]);
        db.run(`UPDATE users SET earnings = earnings + ? WHERE id = ?`, [link.reward, userId]);
        db.run(`INSERT INTO link_history (userId, linkId) VALUES (?, ?)`, [userId, linkId]);

        res.json({ reward: link.reward });
    });
});

// 6. API Chat Room
app.get('/api/chat', (req, res) => {
    db.all(`SELECT sender, text FROM chat_messages ORDER BY id DESC LIMIT 50`, [], (err, rows) => {
        res.json((rows || []).reverse());
    });
});

app.post('/api/chat', (req, res) => {
    const { sender, text } = req.body;
    db.run(`INSERT INTO chat_messages (sender, text) VALUES (?, ?)`, [sender, text], () => {
        res.json({ success: true });
    });
});

// 7. API Dành riêng cho Admin Thống kê Toàn hệ thống
app.get('/api/admin/stats', (req, res) => {
    db.all(`SELECT * FROM links`, [], (err, links) => {
        db.get(`SELECT COUNT(*) as totalUsers FROM users WHERE isAdmin = 0`, [], (err, users) => {
            db.get(`SELECT COUNT(*) as today FROM link_history WHERE DATE(passedAt) = DATE('now')`, [], (err, today) => {
                db.get(`SELECT COUNT(*) as week FROM link_history WHERE passedAt >= DATE('now', '-7 days')`, [], (err, week) => {
                    db.get(`SELECT COUNT(*) as month FROM link_history WHERE passedAt >= DATE('now', '-30 days')`, [], (err, month) => {
                        db.all(`SELECT username, fullName, phone, earnings FROM users WHERE isAdmin = 0 ORDER BY earnings DESC LIMIT 10`, [], (err, topEarners) => {
                            res.json({
                                links: links || [],
                                totalUsers: users ? users.totalUsers : 0,
                                passedToday: today ? today.today : 0,
                                passedWeek: week ? week.week : 0,
                                passedMonth: month ? month.month : 0,
                                topEarners: topEarners || []
                            });
                        });
                    });
                });
            });
        });
    });
});

// 8. Admin Thêm Link
app.post('/api/admin/add-link', (req, res) => {
    const { url, reward, limit } = req.body;
    db.run(`INSERT INTO links (url, reward, remaining) VALUES (?, ?, ?)`, [url, reward, limit], () => {
        res.json({ success: true });
    });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server Backend SQL đang chạy tại cổng http://localhost:${PORT}`));
