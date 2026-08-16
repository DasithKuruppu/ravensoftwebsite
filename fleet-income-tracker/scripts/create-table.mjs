#!/usr/bin/env node
/**
 * Create the `fleet-tracker` table in DynamoDB Local.
 *
 *   npm run ddb:up && npm run ddb:create-table
 *
 * Production's table is created by the CDK stack, not by this script.
 */
import 'dotenv/config';
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

const endpoint = process.env.DDB_ENDPOINT || 'http://localhost:8000';
const TableName = process.env.TABLE_NAME || 'fleet-tracker';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

try {
  await client.send(new DescribeTableCommand({ TableName }));
  console.log(`✓ Table "${TableName}" already exists at ${endpoint}`);
  process.exit(0);
} catch (err) {
  if (err.name !== 'ResourceNotFoundException') {
    console.error(`✗ Cannot reach DynamoDB Local at ${endpoint}`);
    console.error(`  ${err.message}`);
    console.error('  Start it with:  npm run ddb:up');
    process.exit(1);
  }
}

await client.send(
  new CreateTableCommand({
    TableName,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
  }),
);

console.log(`✓ Created table "${TableName}" at ${endpoint}`);
console.log('  Next:  npm run seed');
