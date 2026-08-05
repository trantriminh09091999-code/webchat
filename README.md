# Rôm Rả — Demo Web Chat

Chat realtime đơn giản: gửi tin nhắn, ảnh, video và link cho bạn bè trong cùng phòng.

## Cách chạy

```bash
npm install
node server.js
```

Sau đó mở trình duyệt tới: http://localhost:3000

Mở nhiều tab/trình duyệt khác nhau để giả lập nhiều người chat với nhau.

## Tính năng
- Nhắn tin realtime (Socket.IO)
- Gửi ảnh / video (nút 📎, tối đa 25MB)
- Tự động nhận diện link trong tin nhắn và biến thành link bấm được
- Danh sách người đang online
- Báo "đang nhập..."
- Lưu lịch sử 200 tin nhắn gần nhất (trong bộ nhớ — mất khi restart server)

## Để bạn bè cùng chat qua mạng thật (không chỉ localhost)
Hiện tại code chỉ chạy trên máy bạn (localhost). Để bạn bè ở nơi khác vào chat được, cần deploy lên một dịch vụ hosting, ví dụ:
- **Render.com** hoặc **Railway.app** (có gói miễn phí, dễ deploy cho Node.js)
- Sau khi deploy, bạn sẽ có 1 link công khai (vd: https://ten-app.onrender.com) — gửi link đó cho bạn bè là chat được.

## Giới hạn của bản demo
- Không có đăng nhập/mật khẩu — ai có link cũng vào chung 1 phòng được
- Tin nhắn không mã hóa đầu-cuối
- File ảnh/video lưu trực tiếp trên server (thư mục public/uploads), chưa giới hạn dung lượng lưu trữ tổng
- Đây là bản demo để học/thử nghiệm — nếu dùng thật, cần thêm bảo mật (auth, HTTPS, giới hạn upload, kiểm duyệt nội dung...)
