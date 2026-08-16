#!/usr/bin/env node
/**
 * Generate a bcrypt hash to store in SSM as the owner or driver password.
 *
 *   npm run hash-password -- 'the-password'
 *
 * The plaintext is never written anywhere — copy the hash into the SSM
 * parameter (see deploy.md) and forget the password everywhere else.
 */
import bcrypt from 'bcryptjs';

const password = process.argv[2];

if (!password) {
  console.error("Usage: npm run hash-password -- 'your-password'");
  process.exit(1);
}

console.log(bcrypt.hashSync(password, 10));
