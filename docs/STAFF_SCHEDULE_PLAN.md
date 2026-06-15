# Ke Hoach Nghiep Vu Quan Ly Lich Truc Staff

## Muc Tieu

Module quan ly lich truc giup admin phan ca lam viec cho tung staff, staff xem lich cua minh va thuc hien check-in/check-out ca truc. Module nay phuc vu van hanh thu vien, khong ap dung cho patron va khong thay the luong ra/vao thu vien cua patron.

## Pham Vi MVP

- Admin tao va quan ly ca truc co dinh.
- Admin phan staff vao ca theo ngay.
- Staff xem ca truc cua minh tren web/mobile.
- Staff xac nhan ca, check-in, check-out.
- Admin theo doi trang thai ca: da len lich, da xac nhan, dang truc, hoan thanh, vang, huy.

Chua lam trong MVP:

- Tu dong xep lich thong minh.
- Duyet doi ca phuc tap.
- Tinh luong/phu cap.
- GPS hoac face attendance cho staff.

## Role Va Quyen

### Admin

- Tao/sua/xoa ca truc.
- Phan lich cho staff.
- Sua/huy lich truc.
- Xem lich cua tat ca staff.
- Xem bao cao tong hop.
- Chinh sua trang thai thu cong khi co ngoai le.

### Staff

- Xem lich truc cua minh.
- Xac nhan ca truc.
- Check-in/check-out ca cua minh.
- Khong duoc sua lich cua staff khac.

### Patron

- Khong co quyen truy cap module lich truc.

## Luong Nghiep Vu Chinh

1. Admin vao man hinh `Lich truc`.
2. Admin tao cac ca truc: sang, chieu, toi.
3. Admin chon ngay/tuan va gan staff vao tung ca.
4. He thong kiem tra trung ca va canh bao neu ca thieu staff.
5. Staff dang nhap web/mobile va xem `Ca hom nay`.
6. Staff xac nhan ca truoc khi den gio truc.
7. Staff check-in khi bat dau ca.
8. Staff check-out khi ket thuc ca.
9. Admin xem trang thai va bao cao.

## Quy Tac Nghiep Vu

- Chi `admin` duoc tao/sua/xoa ca va phan lich.
- `staff` chi thao tac voi lich cua chinh minh.
- Khong cho phan mot staff vao hai ca bi trung thoi gian trong cung ngay.
- Khong cho check-in ca da `cancelled`.
- Khong cho check-out neu chua check-in.
- Check-in sau gio bat dau thi danh dau `late`.
- Check-out truoc gio ket thuc thi danh dau `left_early`.
- Ca qua ngay ma khong check-in co the duoc danh dau `absent` boi job dinh ky hoac admin.
- Moi thay doi quan trong can luu audit: ai tao, ai sua, ai huy, ai check-in/check-out.

## Trang Thai

### `staff_schedules.status`

- `scheduled`: da duoc phan lich.
- `confirmed`: staff da xac nhan.
- `in_progress`: staff da check-in va dang truc.
- `completed`: da check-out hop le.
- `absent`: vang mat.
- `cancelled`: lich da huy.

### `staff_attendance.status`

- `on_time`: check-in dung gio.
- `late`: check-in tre.
- `left_early`: check-out som.
- `completed`: hoan thanh ca.
- `missing_checkout`: co check-in nhung chua check-out.

## Database De Xuat

```sql
CREATE TABLE staff_shifts (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  min_staff INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE staff_schedules (
  id UUID PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES users(id),
  shift_id UUID NOT NULL REFERENCES staff_shifts(id),
  work_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
  assigned_by UUID REFERENCES users(id),
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE staff_attendance (
  id UUID PRIMARY KEY,
  schedule_id UUID NOT NULL REFERENCES staff_schedules(id),
  staff_id UUID NOT NULL REFERENCES users(id),
  check_in_at TIMESTAMP,
  check_out_at TIMESTAMP,
  status VARCHAR(30) NOT NULL,
  method VARCHAR(30) NOT NULL DEFAULT 'web',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
```

Index nen co:

```sql
CREATE INDEX idx_staff_schedules_staff_date ON staff_schedules(staff_id, work_date);
CREATE INDEX idx_staff_schedules_date_status ON staff_schedules(work_date, status);
CREATE INDEX idx_staff_attendance_schedule ON staff_attendance(schedule_id);
```

## API Contract MVP

### Admin

```http
GET    /staff
GET    /staff-shifts
POST   /staff-shifts
PUT    /staff-shifts/:id
DELETE /staff-shifts/:id

GET    /staff-schedules?from=&to=&staff_id=&status=
POST   /staff-schedules
PUT    /staff-schedules/:id
DELETE /staff-schedules/:id

GET    /staff-schedules/today
GET    /staff-schedules/summary?from=&to=
```

### Staff

```http
GET  /me/staff-schedules?from=&to=
POST /staff-schedules/:id/confirm
POST /staff-schedules/:id/check-in
POST /staff-schedules/:id/check-out
```

## Validation API

Khi tao/sua `staff_schedules`:

- `staff_id` phai ton tai va co role `staff`.
- `shift_id` phai ton tai va active.
- `work_date` phai hop le.
- Khong trung thoi gian voi ca khac cua cung staff trong ngay.
- Chi admin duoc gan lich cho staff.

Khi check-in:

- Current user phai la staff cua schedule.
- Schedule khong duoc `cancelled`.
- Schedule chua `completed`.
- Neu check-in sau `work_date + shift.start_time` thi attendance la `late`.
- Sau check-in, schedule chuyen `in_progress`.

Khi check-out:

- Phai da check-in.
- Neu check-out truoc `shift.end_time` thi attendance la `left_early`.
- Neu hop le, attendance/schedule chuyen `completed`.

## UI Web

Route moi: `/staff-schedules`

### Admin View

- Header: tong ca hom nay, dang truc, thieu nguoi, vang/tre.
- Calendar theo tuan la mac dinh.
- Filter theo staff, ca, status.
- Bang/list ca truc trong ngay.
- Form phan ca:
  - ngay
  - ca
  - staff
  - note
- Canh bao:
  - staff bi trung ca
  - ca thieu so luong staff toi thieu

### Staff View

- Card `Ca hom nay`.
- Nut `Xac nhan`, `Check-in`, `Check-out` theo trang thai.
- Danh sach lich tuan cua toi.
- Badge trang thai ro rang.

## UI Mobile

Chi hien thi voi role `admin` hoac `staff`.

- Tab `Lich truc`.
- Staff xem ca hom nay va lich tuan.
- Staff check-in/check-out.
- Admin mobile co the chi xem lich trong MVP, chua can phan ca tren mobile.

## Vi Tri Trien Khai

Trien khai bang `schedule-service` rieng de dam bao boundary microservice:

- `schedule-service` so huu schema `schedule` va cac bang lich truc.
- Khong tao FK/query truc tiep sang bang `users`.
- `user-service` van la source of truth cho staff/admin.
- `schedule-service` lay thong tin staff qua internal REST cua `user-service` voi `x-internal-api-key`.
- API Gateway chi proxy `/api/schedules/*`, khong validate nghiep vu.

## Phase Trien Khai

### Phase 1: Backend Foundation

- Tao `schedule-service` Node.js/Express/TypeORM.
- Them migration schema `schedule` cho `library_zones`, `staff_shifts`, `staff_schedules`, `staff_attendance`.
- Them TypeORM entities.
- Them DTO/request validation.
- Them repository/service check trung ca.

### Phase 2: Admin API

- CRUD `staff_shifts`.
- CRUD `staff_schedules`.
- Endpoint list staff.
- Endpoint summary/today.

### Phase 3: Staff API

- `GET /me/staff-schedules`.
- Confirm schedule.
- Check-in/check-out.
- Rule late/left_early.

### Phase 4: Web UI

- Them sidebar `Lich truc`.
- Tao page `/staff-schedules`.
- Admin calendar/list + form phan ca.
- Staff view ca cua toi.

### Phase 5: Mobile Staff

- Them tab `Lich truc`.
- Hien thi ca hom nay/lich tuan.
- Check-in/check-out.

### Phase 6: Bao Cao Va Ngoai Le

- Bao cao vang/tre/hoan thanh.
- Duyet doi ca/nghi phep neu can.
- Job danh dau absent/missing checkout.

## Test Plan

Backend:

- Admin tao/sua/xoa shift thanh cong.
- Staff khong tao/sua/xoa shift duoc.
- Admin phan lich cho staff thanh cong.
- Phan lich trung ca bi 409.
- Staff xem duoc lich cua minh.
- Staff khong xem/sua lich cua staff khac.
- Check-in dung gio -> `on_time`, schedule `in_progress`.
- Check-in tre -> `late`.
- Check-out hop le -> `completed`.
- Check-out som -> `left_early`.
- Check-out khi chua check-in -> 409.

Web:

- Admin thay calendar/list lich truc.
- Staff chi thay lich cua minh.
- Form phan ca hien loi trung ca.
- Badge status hien dung.

Mobile:

- Staff/admin thay tab lich truc.
- Patron khong thay tab.
- Staff check-in/check-out duoc ca cua minh.
