/**
 * UserStore - マルチアカウントのユーザーデータ管理
 */

import fs from 'fs/promises';
import path from 'path';

const USERS_FILE = './data/users.json';

export class UserStore {
  constructor() {
    this.users = {};
  }

  async initialize() {
    await fs.mkdir('./data', { recursive: true });
    const raw = await fs.readFile(USERS_FILE, 'utf-8').catch(() => '{}');
    try {
      this.users = JSON.parse(raw);
    } catch {
      this.users = {};
    }
  }

  async save() {
    await fs.writeFile(USERS_FILE, JSON.stringify(this.users, null, 2), 'utf-8');
  }

  async upsertUser(userId, data) {
    this.users[userId] = {
      ...this.users[userId],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    await this.save();
    return this.users[userId];
  }

  getUser(userId) {
    return this.users[userId] || null;
  }

  getAllUsers() {
    return Object.values(this.users);
  }
}
