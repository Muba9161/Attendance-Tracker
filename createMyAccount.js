/**
 * =====================================================
 *  createMyAccount.js  — VorldX Custom Account Creator
 *  Run:  node createMyAccount.js
 * =====================================================
 *  👇 APNI DETAILS YAHAN BHARO
 */
const MY_NAME = "Ravindra";                        // Apna naam
const MY_EMAIL = "codewithravindra8201@gmail.com";  // Apna email
const MY_PASSWORD = "Ravindra@2026!";                  // Apna password (strong rakhna)
const MY_EMPLOYEE_ID = "EMP-9001";                        // Unique ID (change if conflict)
const MY_DEPARTMENT = "Engineering";
const MY_DESIGNATION = "Full Stack Developer";
const MY_ROLE = "ADMIN";  // ADMIN | HR | EMPLOYEE
// =====================================================

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI || MONGODB_URI.includes('<username>')) {
    console.error('❌ MONGODB_URI is missing or still a placeholder in .env!');
    console.error('   Please set your real Atlas connection string first.');
    process.exit(1);
}

// ─── Minimal Mongoose Schemas ────────────────────────────────────────────────

const UserSchema = new mongoose.Schema({
    employeeId: { type: String, required: true, unique: true, uppercase: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    mobileNumber: { type: String, default: null },
    passwordHash: { type: String, required: true },
    role: { type: String, default: 'EMPLOYEE' },
    status: { type: String, default: 'ACTIVE' },
    isEmailVerified: { type: Boolean, default: true },
    failedLoginAttempts: { type: Number, default: 0 },
    lockoutUntil: { type: Date, default: null },
    refreshTokenHash: { type: String, default: null },
    lastLoginAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

const EmployeeSchema = new mongoose.Schema({
    employeeId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    department: { type: String, required: true },
    designation: { type: String, required: true },
    workType: { type: String, default: 'FULL_TIME' },
    isActive: { type: Boolean, default: true },
    joiningDate: { type: String, default: new Date().toISOString().split('T')[0] },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, versionKey: false });

async function main() {
    console.log('🔄 Connecting to MongoDB Atlas...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected!\n');

    const User = mongoose.model('User', UserSchema);
    const Employee = mongoose.model('Employee', EmployeeSchema);

    // ── Check if already exists ─────────────────────────────────────────────────
    const existingUser = await User.findOne({
        $or: [{ email: MY_EMAIL.toLowerCase() }, { employeeId: MY_EMPLOYEE_ID.toUpperCase() }]
    });

    if (existingUser) {
        // Just update password + status to ACTIVE
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(MY_PASSWORD, salt);
        await User.findByIdAndUpdate(existingUser._id, {
            $set: { passwordHash, status: 'ACTIVE', isEmailVerified: true, role: MY_ROLE }
        });
        console.log(`🔁 Account already exists — updated password & set ACTIVE`);
        console.log(`   Email: ${MY_EMAIL}`);
        console.log(`   Password: ${MY_PASSWORD}`);
        console.log(`   Role: ${MY_ROLE}`);
    } else {
        // Create fresh
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(MY_PASSWORD, salt);

        const user = await User.create({
            employeeId: MY_EMPLOYEE_ID.toUpperCase(),
            email: MY_EMAIL.toLowerCase(),
            passwordHash,
            role: MY_ROLE,
            status: 'ACTIVE',
            isEmailVerified: true,
        });

        await Employee.findOneAndUpdate(
            { employeeId: MY_EMPLOYEE_ID.toUpperCase() },
            {
                $set: {
                    employeeId: MY_EMPLOYEE_ID.toUpperCase(),
                    name: MY_NAME,
                    email: MY_EMAIL.toLowerCase(),
                    department: MY_DEPARTMENT,
                    designation: MY_DESIGNATION,
                    workType: 'FULL_TIME',
                    isActive: true,
                    joiningDate: new Date().toISOString().split('T')[0],
                    userId: user._id,
                }
            },
            { upsert: true, new: true }
        );

        console.log('🎉 Account created successfully!\n');
        console.log('─────────────────────────────────────');
        console.log(`   Name:        ${MY_NAME}`);
        console.log(`   Employee ID: ${MY_EMPLOYEE_ID.toUpperCase()}`);
        console.log(`   Email:       ${MY_EMAIL}`);
        console.log(`   Password:    ${MY_PASSWORD}`);
        console.log(`   Role:        ${MY_ROLE}`);
        console.log('─────────────────────────────────────');
    }

    console.log('\n✅ Ab login karo in credentials se!');
    await mongoose.disconnect();
    process.exit(0);
}

main().catch(async (err) => {
    console.error('❌ Error:', err.message);
    await mongoose.disconnect();
    process.exit(1);
});
