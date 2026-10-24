// src/scripts/seed-test-data.ts
//
// Seeds comprehensive test data for development and CI validation.
//
// Lives under src/ rather than scripts/ so `tsc` compiles it into dist/ with
// the rest of the server, which is what lets a preview deployment run it inside
// its own pod (see scripts/preview.mjs). scripts/ is for the one-off tooling
// that never has to run in the image.
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ensureRegistry, provisionFamily, getFamilyClient } from '../db-namespaces';
import { NAMESPACE_HOUSEHOLD_ID } from '../db-core';
import { categoryTemplate } from '../registry';

// The fixtures' fixed identity, shared with validate-seed.ts so the two
// scripts cannot disagree about which family they are talking about.
export const TEST_FAMILY_ID = '00000000-0000-4000-8000-000000000001';
export const TEST_EMAIL = 'test@example.com';
export const TEST_PASSWORD = 'TestPass123!';

async function seedTestData() {
  console.log('🌱 Seeding comprehensive test data...');

  try {
    // Ensure registry exists
    await ensureRegistry();

    // Create test family
    const familyId = TEST_FAMILY_ID;
    const familyName = 'Test Family';
    const email = TEST_EMAIL;

    // Seed once, then leave it alone.
    //
    // A preview redeploys on every push against the same namespace, so this
    // runs repeatedly against a database that already holds the fixtures — and
    // possibly a reviewer's own family beside them. Re-inserting would
    // duplicate every record (the ids are autoincrement) and the user replace
    // would break the foreign keys that reference it. Seeding is a one-time
    // fill of an empty database; if the account is already there, there is
    // nothing to do. Delete the data directory to start over.
    const registry = await ensureRegistry();
    const alreadySeeded = await registry.execute({
      sql: 'SELECT user_id FROM user_routing WHERE email = ? LIMIT 1',
      args: [email],
    });
    if (alreadySeeded.rows.length > 0) {
      console.log(`✅ Test data already present (${email}) — nothing to seed.`);
      process.exit(0);
    }

    console.log(`Creating test family: ${familyId}`);
    await provisionFamily(familyId, familyName);
    
    const familyDb = getFamilyClient(familyId);
    
    // Create a test user
    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    
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
    const now = new Date().toISOString();
    await registry.execute({
      sql: `INSERT OR REPLACE INTO user_routing (id, email, family_id, user_id, role, is_platform_admin, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), email, familyId, userId, 'owner', 0, now, now],
    });
    
    // Create family members, each starting with the category set their stage
    // implies — the same template a real member gets, so a preview exercises
    // the stage model rather than the fallback list. (An adult used to land on
    // the child default, which made the vitamins tile look broken.)
    const member1Result = await familyDb.execute({
      sql: `INSERT INTO family_members (household_id, name, member_type, birth_date, gender, stage, categories)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [NAMESPACE_HOUSEHOLD_ID, 'Baby Test', 'child', '2024-01-01', 'other', null, JSON.stringify(categoryTemplate(null))],
    });
    const member1Id = Number(member1Result.lastInsertRowid);

    await familyDb.execute({
      sql: `INSERT INTO family_members (household_id, name, member_type, birth_date, gender, stage, categories)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [NAMESPACE_HOUSEHOLD_ID, 'Test Parent', 'adult', '1990-01-01', 'female', 'adult', JSON.stringify(categoryTemplate('adult'))],
    });

    // Create subject entries
    const subject1Result = await familyDb.execute({
      sql: `INSERT INTO subjects (household_id, name, birth_date, gender, type, categories) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [NAMESPACE_HOUSEHOLD_ID, 'Baby Test', '2024-01-01', 'other', 'child', JSON.stringify(categoryTemplate(null))],
    });
    const subjectId = Number(subject1Result.lastInsertRowid);

    await familyDb.execute({
      sql: `INSERT INTO subjects (household_id, name, birth_date, gender, type, categories) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [NAMESPACE_HOUSEHOLD_ID, 'Test Pet', '2023-06-01', 'male', 'pet', JSON.stringify(categoryTemplate('pet'))],
    });
    
    // Add comprehensive sample data
    const nowMs = Date.now();
    const day = 24 * 3600 * 1000;
    
    // Feedings
    for (let i = 0; i < 10; i++) {
      await familyDb.execute({
        sql: `INSERT INTO feedings (subject_id, start_time, end_time, duration, amount, amount_unit, type) 
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          subjectId, 
          new Date(nowMs - (i + 1) * 4 * 3600 * 1000).toISOString(), 
          new Date(nowMs - (i + 1) * 4 * 3600 * 1000 + 30 * 60 * 1000).toISOString(), 
          30, 
          4.5 + i * 0.5, 
          'oz', 
          i % 2 === 0 ? 'bottle' : 'breast'
        ],
      });
    }
    
    // Diapers
    for (let i = 0; i < 15; i++) {
      const types = ['wet', 'soiled', 'mixed', 'dry'];
      await familyDb.execute({
        sql: `INSERT INTO diapers (subject_id, change_time, type) VALUES (?, ?, ?)`,
        args: [subjectId, new Date(nowMs - i * 2 * 3600 * 1000).toISOString(), types[i % types.length]],
      });
    }
    
    // Sleep
    for (let i = 0; i < 7; i++) {
      await familyDb.execute({
        sql: `INSERT INTO sleep (subject_id, start_time, end_time, duration) VALUES (?, ?, ?, ?)`,
        args: [
          subjectId, 
          new Date(nowMs - (i + 1) * day + 22 * 3600 * 1000).toISOString(), 
          new Date(nowMs - i * day + 6 * 3600 * 1000).toISOString(), 
          480
        ],
      });
    }
    
    // Growth measurements
    await familyDb.execute({
      sql: `INSERT INTO growth (subject_id, measurement_date, weight, height, head_circumference, unit_system) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [subjectId, new Date(nowMs - 30 * day).toISOString().split('T')[0], 12.5, 24.5, 16.2, 'imperial'],
    });
    await familyDb.execute({
      sql: `INSERT INTO growth (subject_id, measurement_date, weight, height, head_circumference, unit_system) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [subjectId, new Date(nowMs - 60 * day).toISOString().split('T')[0], 10.2, 22.8, 15.8, 'imperial'],
    });
    
    // Milestones — events rows now, one per category, with the option value
    // in the data document under the category's own key.
    await familyDb.execute({
      sql: `INSERT INTO events (subject_id, category, occurred_at, title, notes, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [subjectId, 'milestones', new Date(nowMs - 45 * day).toISOString().split('T')[0], 'First Smile', 'Smiled for the first time', JSON.stringify({ category: 'social' }), new Date().toISOString()],
    });
    await familyDb.execute({
      sql: `INSERT INTO events (subject_id, category, occurred_at, title, notes, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [subjectId, 'vitamins', new Date(nowMs - 1 * day).toISOString(), 'Vitamin D', null, JSON.stringify({ type: 'dose' }), new Date().toISOString()],
    });
    
    // Moods
    for (let i = 0; i < 5; i++) {
      const moods = ['happy', 'calm', 'fussy', 'tired', 'excited'];
      await familyDb.execute({
        sql: `INSERT INTO moods (subject_id, mood, recorded_at) VALUES (?, ?, ?)`,
        args: [subjectId, moods[i % moods.length], new Date(nowMs - i * 12 * 3600 * 1000).toISOString()],
      });
    }
    
    // Journal entries
    await familyDb.execute({
      sql: `INSERT INTO journal_entries (subject_id, title, body, entry_date) VALUES (?, ?, ?, ?)`,
      args: [subjectId, 'Great day', 'Baby had a great day today, lots of smiles!', new Date(nowMs - 2 * day).toISOString().split('T')[0]],
    });
    
    // A booked appointment, so the preview's upcoming list has something to
    // show and the plan prompt is exercisable end to end.
    await familyDb.execute({
      sql: `INSERT INTO plans (subject_id, category, scheduled_at, title, data, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [subjectId, 'appointments', new Date(nowMs + 7 * day).toISOString(), 'Six-month checkup', JSON.stringify({ type: 'checkup' }), new Date().toISOString()],
    });

    // Reminders
    await familyDb.execute({
      sql: `INSERT INTO reminders (family_id, kind, label, interval_days, enabled) VALUES (?, ?, ?, ?, ?)`,
      args: [NAMESPACE_HOUSEHOLD_ID, 'diaper', 'Change diaper', 3, 1],
    });
    
    console.log('✅ Comprehensive test data seeded successfully!');
    console.log(`   Family ID: ${familyId}`);
    console.log(`   User: ${email} / ${TEST_PASSWORD}`);
    console.log(`   Members: Baby Test (child), Test Parent (adult, adult categories)`);
    console.log(`   Subjects: Baby Test, Test Pet (pet categories)`);
    console.log(`   Added: 10 feedings, 15 diapers, 7 sleep records, 2 growth records, a milestone + a vitamin event, 5 moods, journal entry, a booked checkup, reminder`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding test data:', error);
    process.exit(1);
  }
}

// Run only as the entry point (`node dist/scripts/seed-test-data.js`), not
// when imported for its constants — validate-seed.ts reads TEST_FAMILY_ID and
// friends and must not seed as a side effect. The dist is CommonJS, where the
// entry-point check is require.main rather than import.meta.
if (require.main === module) {
  seedTestData();
}
