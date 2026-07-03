"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Book = void 0;
const typeorm_1 = require("typeorm");
const BookCopy_1 = require("./BookCopy");
let Book = class Book {
};
exports.Book = Book;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Book.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20, unique: true }),
    __metadata("design:type", String)
], Book.prototype, "isbn", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 500 }),
    __metadata("design:type", String)
], Book.prototype, "title", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 500, nullable: true }),
    __metadata("design:type", Object)
], Book.prototype, "subtitle", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", Object)
], Book.prototype, "author", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'cover_url', type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Book.prototype, "coverUrl", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true }),
    __metadata("design:type", Object)
], Book.prototype, "publisher", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'published_date', type: 'varchar', length: 20, nullable: true }),
    __metadata("design:type", Object)
], Book.prototype, "publishedDate", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], Book.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'page_count', type: 'int', nullable: true }),
    __metadata("design:type", Object)
], Book.prototype, "pageCount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 500, nullable: true }),
    __metadata("design:type", Object)
], Book.prototype, "categories", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'average_rating', type: 'decimal', precision: 3, scale: 1, nullable: true }),
    __metadata("design:type", Object)
], Book.prototype, "averageRating", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 10, nullable: true }),
    __metadata("design:type", Object)
], Book.prototype, "language", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'isbn10', type: 'varchar', length: 10, nullable: true }),
    __metadata("design:type", Object)
], Book.prototype, "isbn10", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'isbn13', type: 'varchar', length: 13, nullable: true }),
    __metadata("design:type", Object)
], Book.prototype, "isbn13", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'is_available', type: 'boolean', default: true }),
    __metadata("design:type", Boolean)
], Book.prototype, "isAvailable", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'shelf_location', type: 'varchar', length: 100, nullable: true }),
    __metadata("design:type", Object)
], Book.prototype, "shelfLocation", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], Book.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }),
    __metadata("design:type", Date)
], Book.prototype, "updatedAt", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => BookCopy_1.BookCopy, (copy) => copy.book),
    __metadata("design:type", Array)
], Book.prototype, "copies", void 0);
exports.Book = Book = __decorate([
    (0, typeorm_1.Entity)({ name: 'books' })
], Book);
