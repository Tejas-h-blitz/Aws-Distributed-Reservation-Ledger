import { strict as assert } from "node:assert";
import { RedisInventoryRepository } from "../../src/repository/inventory.redis";

async function run(): Promise<void> {
  const repository = Object.create(RedisInventoryRepository.prototype) as RedisInventoryRepository;
  const commands: Array<Array<string | number>> = [];
  const fakeRedis = {
    set: async (...args: Array<string | number>) => {
      commands.push(["SET", ...args]);
      return "OK";
    },
    expire: async (...args: Array<string | number>) => {
      commands.push(["EXPIRE", ...args]);
      return 1;
    },
  };
  Object.defineProperty(repository, "redis", { value: fakeRedis });

  await repository.setStock("phase0-retention-event", 1);

  const hasExpiration = commands.some(command => {
    const operation = String(command[0]).toUpperCase();
    if (["EXPIRE", "PEXPIRE", "EXPIREAT", "PEXPIREAT"].includes(operation)) {
      const expiry = Number(command[2]);
      return Number.isFinite(expiry) && expiry > 0;
    }
    if (operation === "SET") {
      return command.some((value, index) => {
        const option = String(value).toUpperCase();
        if (!["EX", "PX", "EXAT", "PXAT"].includes(option)) {
          return false;
        }
        const expiry = Number(command[index + 1]);
        return Number.isFinite(expiry) &&
          (option === "EXAT" || option === "PXAT" ? expiry > Date.now() : expiry > 0);
      });
    }
    return false;
  });

  assert.ok(hasExpiration, "Redis inventory initialization must attach an expiry policy to its key");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
