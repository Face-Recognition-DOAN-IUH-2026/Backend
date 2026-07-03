"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddAvatarUrl1719000010000 = void 0;
class AddAvatarUrl1719000010000 {
    constructor() {
        this.name = 'AddAvatarUrl1719000010000';
    }
    async up(queryRunner) {
        await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS avatar_url TEXT
    `);
    }
    async down(queryRunner) {
        await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS avatar_url
    `);
    }
}
exports.AddAvatarUrl1719000010000 = AddAvatarUrl1719000010000;
