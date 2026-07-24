"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisInventoryRepository = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
class RedisInventoryRepository {
    redis;
    constructor(config) {
        this.redis = new ioredis_1.default({
            host: config?.host || process.env.REDIS_HOST || "localhost",
            port: config?.port || Number(process.env.REDIS_PORT) || 6379,
            maxRetriesPerRequest: 1, // Fail fast so that fallback logic runs immediately
            connectTimeout: 2000,
        });
    }
    async decrementStock(eventId) {
        const key = `inventory:${eventId}`;
        const luaScript = `
      if redis.call("exists", KEYS[1]) == 1 then
          local current = tonumber(redis.call("get", KEYS[1]))
          if current > 0 then
              redis.call("decr", KEYS[1])
              return 1
          else
              return 0
          end
      else
          return -1
      end
    `;
        const res = await this.redis.eval(luaScript, 1, key);
        if (res === 1) {
            return true;
        }
        else if (res === 0) {
            return false; // Out of stock
        }
        else {
            // Key not initialized in Redis
            throw new Error(`Inventory key ${key} is not initialized in Redis.`);
        }
    }
    async incrementStock(eventId) {
        const key = `inventory:${eventId}`;
        // Only increment if the key exists (avoid orphaned increments for unseeded items)
        const luaScript = `
      if redis.call("exists", KEYS[1]) == 1 then
          redis.call("incr", KEYS[1])
          return 1
      else
          return 0
      end
    `;
        await this.redis.eval(luaScript, 1, key);
    }
    async getCurrentStock(eventId) {
        const key = `inventory:${eventId}`;
        const val = await this.redis.get(key);
        return val !== null ? parseInt(val, 10) : -1;
    }
    async setStock(eventId, count) {
        const key = `inventory:${eventId}`;
        await this.redis.set(key, count);
    }
    async close() {
        try {
            await this.redis.quit();
        }
        catch {
            // Ignore force close issues
        }
    }
}
exports.RedisInventoryRepository = RedisInventoryRepository;
