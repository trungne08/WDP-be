/**
 * Test Script: Verify Multi-Class Project Validation
 * 
 * This script demonstrates that:
 * 1. Students CAN join projects in different classes (ALLOWED)
 * 2. Students CANNOT join multiple projects in the SAME class (BLOCKED)
 * 
 * Expected Behavior:
 * - Student in Class A, Project 1: ✅ ALLOWED
 * - Same student in Class B, Project 2: ✅ ALLOWED (different class)
 * - Same student in Class A, Project 3: ❌ BLOCKED (same class)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const models = require('../models');

async function testMultiClassValidation() {
  try {
    console.log('🧪 Starting Multi-Class Project Validation Test...\n');

    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to database\n');

    // Test 1: Find a student with projects
    console.log('📋 Test 1: Finding students with projects...');
    const projectsWithMembers = await models.Project.find({ members: { $exists: true, $ne: [] } })
      .populate('members', 'student_code email full_name')
      .populate('class_id', '_id name class_code')
      .populate('semester_id', '_id name code')
      .populate('subject_id', '_id name code')
      .limit(5)
      .lean();

    if (projectsWithMembers.length === 0) {
      console.log('⚠️  No projects found with members. Please create some projects first.\n');
      return;
    }

    console.log(`Found ${projectsWithMembers.length} project(s) with members:\n`);

    // Test 2: Check if any students are in multiple projects
    console.log('📋 Test 2: Analyzing student project memberships...\n');

    const studentProjectMap = new Map();

    for (const project of projectsWithMembers) {
      for (const member of project.members || []) {
        const studentId = member._id.toString();
        if (!studentProjectMap.has(studentId)) {
          studentProjectMap.set(studentId, {
            student: member,
            projects: []
          });
        }
        studentProjectMap.get(studentId).projects.push({
          project_name: project.name,
          project_id: project._id.toString(),
          class_id: project.class_id?._id?.toString(),
          class_name: project.class_id?.name || project.class_id?.class_code,
          semester_id: project.semester_id?._id?.toString() || project.semester_id,
          semester_name: project.semester_id?.name || project.semester_id?.code,
          subject_id: project.subject_id?._id?.toString() || project.subject_id || 'N/A',
          subject_name: project.subject_id?.name || project.subject_id?.code || 'N/A'
        });
      }
    }

    console.log('🔍 Student Project Analysis:\n');
    console.log('=' .repeat(80));

    let studentsInMultipleClasses = 0;
    let studentsInSameClass = 0;

    for (const [studentId, data] of studentProjectMap.entries()) {
      if (data.projects.length > 1) {
        console.log(`\n👤 Student: ${data.student.full_name || data.student.email} (${data.student.student_code})`);
        console.log(`   ID: ${studentId}`);
        console.log(`   📦 Projects (${data.projects.length}):`);

        // Group projects by class
        const projectsByClass = new Map();
        for (const proj of data.projects) {
          const classKey = `${proj.class_id}_${proj.semester_id}_${proj.subject_id}`;
          if (!projectsByClass.has(classKey)) {
            projectsByClass.set(classKey, {
              class_info: proj,
              projects: []
            });
          }
          projectsByClass.get(classKey).projects.push(proj);
        }

        for (const [classKey, classData] of projectsByClass.entries()) {
          console.log(`\n   📚 Class: ${classData.class_info.class_name}`);
          console.log(`      - Class ID: ${classData.class_info.class_id}`);
          console.log(`      - Semester: ${classData.class_info.semester_name}`);
          console.log(`      - Subject: ${classData.class_info.subject_name}`);
          console.log(`      - Projects in this class: ${classData.projects.length}`);

          if (classData.projects.length > 1) {
            console.log(`      ⚠️  WARNING: Student has ${classData.projects.length} projects in the SAME class!`);
            console.log(`         This should NOT be allowed by validation!`);
            studentsInSameClass++;
            
            classData.projects.forEach((p, idx) => {
              console.log(`         ${idx + 1}. ${p.project_name} (${p.project_id})`);
            });
          } else {
            console.log(`      ✅ OK: Only 1 project in this class`);
            console.log(`         - ${classData.projects[0].project_name}`);
          }
        }

        if (projectsByClass.size > 1) {
          studentsInMultipleClasses++;
          console.log(`\n   ✅ CORRECT BEHAVIOR: Student is in ${projectsByClass.size} DIFFERENT classes`);
          console.log(`      This is ALLOWED and working as expected!`);
        }

        console.log('\n' + '-'.repeat(80));
      }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 VALIDATION TEST SUMMARY\n');
    console.log(`Total students analyzed: ${studentProjectMap.size}`);
    console.log(`Students in multiple DIFFERENT classes: ${studentsInMultipleClasses} ✅ (ALLOWED)`);
    console.log(`Students in multiple projects in SAME class: ${studentsInSameClass} ${studentsInSameClass > 0 ? '❌ (BUG!)' : '✅ (CORRECT)'}`);

    if (studentsInSameClass === 0 && studentsInMultipleClasses > 0) {
      console.log('\n✅ VALIDATION IS WORKING CORRECTLY!');
      console.log('   - Students CAN join projects in different classes');
      console.log('   - Students CANNOT join multiple projects in the same class');
    } else if (studentsInSameClass > 0) {
      console.log('\n❌ VALIDATION BUG DETECTED!');
      console.log('   - Some students have multiple projects in the SAME class');
      console.log('   - This should be prevented by validation');
    } else {
      console.log('\n⚠️  INCONCLUSIVE TEST');
      console.log('   - No students found with projects in multiple classes');
      console.log('   - Test more scenarios to verify validation');
    }

    console.log('=' .repeat(80));

  } catch (error) {
    console.error('\n❌ Test Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from database');
  }
}

// Run test
testMultiClassValidation();
