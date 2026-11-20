require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;

async function test() {
  if (!uri) {
    console.error('❌ MONGODB_URI is not set in .env file!');
    process.exit(1);
  }

  console.log('🔄 Connecting to MongoDB...');
  console.log('   URI:', uri);

  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB successfully!');

    const dbs = await client.db().admin().listDatabases();
    console.log('📂 Databases:', dbs.databases.map(d => d.name).join(', '));
  } catch (err) {
    console.error('❌ Failed to connect:', err.message);
  } finally {
    await client.close();
    console.log('🔒 Connection closed.');
  }
}

test();
