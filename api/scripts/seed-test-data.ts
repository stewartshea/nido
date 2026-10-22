#!/usr/bin/env tsx
// scripts/seed-test-data.ts
// Seeds test data for development and CI validation
// Creates a test family with sample data (baby, feedings, diapers, etc.)
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ensureRegistry, provisionFamily, getFamilyClient } from '../src/db-namespaces';
import { NAMESPACE_HOUSEHOLD_ID } from '../src/db-core';

async function seedTestData() {
  console.log('🌱 Seeding test data...');
  
  try {
    // Ensure registry exists
    await ensureRegistry();
    
    // Create test family
    const familyId = '00000000-0000-4000-8000-000000000001';
    const familyName = 'Test Family';
    
    console.log(`Creating test family: ${familyId}`);
    await provisionFamily(familyId, familyName);
    
    const familyDb = getFamilyClient(familyId);
    
    // Create a test user
    const userId = randomUUID();
    const email = 'test@example.com';
    const passwordHash = await bcrypt.hash('TestPass123!', 10);
    
    await familyDb.execute({
      sql: `INSERT OR REPLACE INTO users (id, email, password_hash, first_name, last_name, email_verified) 
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [userId, email, passwordHash, 'Test', 'User', 1],
    });
    
    // Link user to household
    await familyDb.execute({
      sql: `INSERT OR REPLACE INTO user_households (user_id, household_id, role) VALUES (?, ?, ?)`,
      args: [userId, NAMESPACE_HOUSEHOLD_ID, 'owner'],
    });
    
    // Add user to registry routing
    const registry = await ensureRegistry();
    const now = new Date().toISOString();
    await registry.execute({
      sql: `INSERT OR REPLACE INTO user_routing (id, email, family_id, user_id, role, is_platform_admin, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), email, familyId, userId, 'owner', 0, now, now],
    });
    
    // Create a test baby/member
    const memberResult = await familyDb.execute({
      sql: `INSERT INTO family_members (household_id, name, member_type, birth_date, gender) 
            VALUES (?, ?, ?, ?, ?)`,
      args: [NAMESPACE_HOUSEHOLD_ID, 'Baby Test', 'child', '2024-01-01', 'other'],
    });
    const memberId = Number(memberResult.lastInsertRowid);
    
    // Add some sample feedings
    const now = Date.now();
    await familyDb.execute({
      sql: `INSERT INTO feedings (baby_id, start_time, end_time, duration, amount, type) 
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [memberId, new Date(now - 2 * 3600 * 1000).toISOString(), new Date(now - 2 * 3600 * 1000 + 30 * 60 * 1000).toISOString(), 30, 4.5, 'bottle'],
    });
    
    // Add some sample diapers
    await familyDb.execute({
      sql: `INSERT INTO diapers (baby_id, change_time, type) VALUES (?, ?, ?)`,
      args: [memberId, new Date(now - 1 * 3600 * 1000).toISOString(), 'wet'],
    });
    
    // Add some sample sleep
    await familyDb.execute({
      sql: `INSERT INTO sleep (baby_id, start_time, end_time, duration) VALUES (?, ?, ?, ?)`,
      args: [memberId, new Date(now - 8 * 3600 * 1000).toISOString(), new Date(now - 3 * 3600 * 1000).toISOString(), 300],
    });
    
    console.log('✅ Test data seeded successfully!');
    console.log(`   Family ID: ${familyId}`);
    console.log(`   User: ${email} / TestPass123!`);
    console.log(`   Member: Baby Test (child)`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding test data:', error);
    process.exit(1);
  }
}

seedTestData();
