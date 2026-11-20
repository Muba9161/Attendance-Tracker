process.env.NODE_ENV = "test";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { beforeAll, afterAll, afterEach } from "vitest";

let mongod: MongoMemoryReplSet | null = null;
export let inMemoryMongoUri: string | null = null;

beforeAll(async () => {
  try {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    inMemoryMongoUri = mongod.getUri();
    await mongoose.connect(inMemoryMongoUri);
  } catch (err) {
    console.warn(
      "Notice: In-memory MongoDB initialization skipped or failed, connecting to fallback:",
      err
    );
  }
}, 60000);

afterAll(async () => {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongod) {
      await mongod.stop();
    }
  } catch (err) {
    console.warn("Cleanup error:", err);
  }
});

afterEach(async () => {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    try {
      const collections = await mongoose.connection.db.collections();
      for (const collection of collections) {
        await collection.deleteMany({});
      }
    } catch {
      // Ignored for unit tests that do not write collections
    }
  }
});
