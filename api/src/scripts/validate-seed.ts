// src/scripts/validate-seed.ts
// Validates that seeded test environment is functional
import { ensureRegistry, getFamilyClient } from '../db-namespaces';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'nido-test-secret';

async function validateSeed() {
  console.log('🔍 Validating test environment...');
  
  try {
    await ensureRegistry();
    
    const familyId = '00000000-0000-4000-8000-000000000001';
    const familyDb = getFamilyClient(familyId);
    
    // Check family exists
    const family = await familyDb.execute({ sql: 'SELECT * FROM households WHERE id = 1' });
    if (family.rows.length === 0) {
      throw new Error('Household not found');
    }
    console.log('✓ Household exists');
    
    // Check user exists
    const user = await familyDb.execute({ sql: "SELECT * FROM users WHERE email = 'test@example.com'" });
    if (user.rows.length === 0) {
      throw new Error('Test user not found');
    }
    console.log('✓ Test user exists');
    
    // Check member exists
    const members = await familyDb.execute({ sql: 'SELECT * FROM family_members' });
    if (members.rows.length === 0) {
      throw new Error('No family members found');
    }
    console.log(`✓ ${members.rows.length} family member(s) exist`);
    
    // Check subject exists
    const subjects = await familyDb.execute({ sql: 'SELECT * FROM subjects' });
    console.log(`✓ ${subjects.rows.length} subject(s) exist`);
    
    // Check data exists
    const feedings = await familyDb.execute({ sql: 'SELECT COUNT(*) as count FROM feedings' });
    const diapers = await familyDb.execute({ sql: 'SELECT COUNT(*) as count FROM diapers' });
    const sleep = await familyDb.execute({ sql: 'SELECT COUNT(*) as count FROM sleep' });
    
    console.log(`✓ Data present: ${feedings.rows[0]?.count} feedings, ${diapers.rows[0]?.count} diapers, ${sleep.rows[0]?.count} sleep records`);
    
    // Test JWT generation
    const token = jwt.sign({ userId: user.rows[0]?.id, familyId }, JWT_SECRET);
    if (!token) {
      throw new Error('JWT generation failed');
    }
    console.log('✓ JWT generation works');
    
    // Test JWT verification
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded.familyId !== familyId) {
      throw new Error('JWT verification failed');
    }
    console.log('✓ JWT verification works');
    
    console.log('\n✅ Test environment validation passed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  }
}

validateSeed();
