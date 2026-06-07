# 🔐 Auth App — Đăng nhập / Đăng ký với OTP Email thật

## Cấu trúc thư mục

```
auth-app/
├── server.js         ← Backend Node.js
├── package.json      ← Danh sách thư viện
├── .env              ← Cấu hình Gmail (bạn cần sửa file này)
├── users.json        ← Dữ liệu user (tự tạo khi chạy)
└── public/
    └── index.html    ← Giao diện web
```

---

## ⚙️ Cài đặt & Chạy

### Bước 1: Cài Node.js
Tải tại https://nodejs.org (chọn bản LTS)

### Bước 2: Mở thư mục dự án
```bash
cd auth-app
```

### Bước 3: Cài thư viện
```bash
npm install
```

### Bước 4: Cấu hình Gmail trong file `.env`
```
GMAIL_USER=your_email@gmail.com
GMAIL_PASS=xxxx xxxx xxxx xxxx
```

> **Lấy App Password Gmail:**
> 1. Vào https://myaccount.google.com/security
> 2. Bật **Xác minh 2 bước** (nếu chưa có)
> 3. Vào https://myaccount.google.com/apppasswords
> 4. Tạo mật khẩu ứng dụng → chọn "Mail" → Copy mã 16 ký tự → dán vào GMAIL_PASS

### Bước 5: Chạy server
```bash
npm start
```

### Bước 6: Mở trình duyệt
Truy cập: http://localhost:3000

---

## 🚀 Tính năng

- ✅ Đăng ký tài khoản với xác thực OTP email thật
- ✅ OTP hết hạn sau 5 phút
- ✅ Mật khẩu được mã hóa (bcrypt)
- ✅ Đăng nhập / Đăng xuất
- ✅ Giao diện đẹp, hiện đại
- ✅ Lưu dữ liệu vào file users.json
