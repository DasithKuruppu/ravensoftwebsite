import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';

const db = new DynamoDBClient({});
const TABLE = process.env.TABLE_NAME;

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://ravensoft.click',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };

  // CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { name, email, message } = body;
  if (!name || !email || !message) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'name, email, and message are required.' }) };
  }

  // Basic email format guard
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email address.' }) };
  }

  const id = randomUUID();
  const ts = new Date().toISOString();

  await db.send(new PutItemCommand({
    TableName: TABLE,
    Item: {
      id:        { S: id },
      timestamp: { S: ts },
      name:      { S: name.slice(0, 200) },
      email:     { S: email.slice(0, 254) },
      message:   { S: message.slice(0, 5000) },
    },
  }));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, id }),
  };
};
