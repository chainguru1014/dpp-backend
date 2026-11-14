const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');
const User = require('../models/userModel');
const Company = require('../models/companyModel');
const Employee = require('../models/employeeModel');
const AppError = require('../utils/appError');
const { buildUserResponse, buildCompanyResponse, signJwt } = require('../utils/authShared');
const { findOrLinkOrCreateByEmail, normalizeEmail } = require('../utils/authLink');
const { emailDomain, hashEmail } = require('../utils/pii');
const { generateOtp, sendOtpEmail, OTP_EXPIRY_MINUTES } = require('../utils/otp');
const { appendAuditLog } = require('../utils/employeeAuditLog');
const { buildEmployeeResponse } = require('./employeeAuthController');
const { createNotification } = require('./notificationController');
const StaffSignup = require('../models/staffSignupModel');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { hashPassword, verifyPassword, passwordProblem } = require('../utils/password');

/**
 * Fire-and-forget "New sign-in" notification for a User actor. Best-effort —
 * never blocks the auth response.
 */
const notifyLoginAlert = (actor: any, req: any) => {
    try {
        if (!actor?._id) return;
        const ua = String(req?.headers?.['user-agent'] || '').slice(0, 120);
        createNotification({
            audience: 'user',
            recipient: { kind: 'User', id: actor._id, email: actor.email, name: actor.name },
            type: 'login_alert',
            level: 'warning',
            title: 'Security Alert',
            message: ua ? `New sign-in detected on ${ua}` : 'A new sign-in to your account was detected.',
            data: { at: new Date().toISOString() }
        });
    } catch (err) {
        console.error('notifyLoginAlert failed:', err);
    }
};

const normalizeUsername = (value: any) => (typeof value === 'string' ? value.trim() : '');

// Testing-only master OTP code — accepted for ANY email when set, on top of
// the real per-request code. Opt-in via env (unset = disabled) rather than
// hardcoded, so it can't silently end up active if TEST_OTP_CODE isn't set
// in an environment's .env. Remove/unset TEST_OTP_CODE before any real
// production deployment — this bypasses login verification entirely.
const TEST_OTP_CODE = process.env.TEST_OTP_CODE || '';

/** Shared response envelope for google/apple/otpVerify — mirrors the shape
 * the legacy /user/google-login endpoint returned, plus an actorKind field. */
const sendAuthResponse = (res: any, result: any, req?: any) => {
    const { actorKind, actor, token } = result;
    const data = actorKind === 'Company' ? buildCompanyResponse(actor) : buildUserResponse(actor);
    // "New sign-in" alert — consumer (User) accounts only, and only once the
    // profile is complete (a first-ever signup still needs onboarding, not a
    // security alert).
    if (actorKind === 'User' && actor.profileCompleted !== false) {
        notifyLoginAlert(actor, req);
    }
    // Strict `=== false` (not a falsy check): existing companies created
    // before this field existed have it entirely unset, and must be treated
    // as complete, not silently forced through profile completion again.
    const message = actor.profileCompleted === false
        ? 'Profile completion required'
        : 'Login successful';

    return res.status(200).json({
        status: 'success',
        token,
        user: data,
        actorKind,
        message
    });
};

// POST /auth/google — verifies a Google ID token (not a client-supplied access
// token) via google-auth-library, then finds/links/creates the matching
// User or Company by email.
exports.google = async (req: any, res: any, next: any) => {
    try {
        const { idToken } = req.body || {};
        if (!idToken) {
            return res.status(400).json({ status: 'fail', message: 'idToken is required' });
        }

        const clientIds = [
            process.env.GOOGLE_WEB_CLIENT_ID,
            process.env.GOOGLE_ANDROID_CLIENT_ID,
            process.env.GOOGLE_IOS_CLIENT_ID
        ].filter(Boolean);

        if (!clientIds.length) {
            return next(new AppError(500, 'error', 'Google sign-in is not configured'));
        }

        const client = new OAuth2Client();
        let ticket;
        try {
            ticket = await client.verifyIdToken({ idToken, audience: clientIds });
        } catch (err) {
            return res.status(401).json({ status: 'fail', message: 'Invalid Google ID token' });
        }

        const payload = ticket.getPayload();
        if (!payload || !payload.email) {
            return res.status(401).json({ status: 'fail', message: 'Google token did not include an email' });
        }

        // A staff employee's email signs in as that employee (see findOtpOwner).
        const employee = await findActiveEmployeeByEmail(payload.email);
        if (employee) {
            return await sendEmployeeAuthResponse(employee, req, res);
        }
        // Registering as a professional (staff) user: only emails a company
        // has put on its staff list may continue; never create a User here.
        if (req.body?.accountType === 'professional') {
            return notEmployee(res);
        }

        const result = await findOrLinkOrCreateByEmail({
            email: payload.email,
            provider: 'google',
            providerId: payload.sub,
            profileHints: {
                name: payload.name,
                firstName: payload.given_name,
                lastName: payload.family_name,
                avatar: payload.picture
            }
        });

        return sendAuthResponse(res, result, req);
    } catch (error) {
        next(error);
    }
};

// POST /auth/apple — verifies an Apple identityToken via apple-signin-auth.
// Apple only sends the user's name on the very first authorization (from the
// client, not the token), so we accept it opportunistically for new accounts.
exports.apple = async (req: any, res: any, next: any) => {
    try {
        const { identityToken, user } = req.body || {};
        if (!identityToken) {
            return res.status(400).json({ status: 'fail', message: 'identityToken is required' });
        }

        const audience = String(process.env.APPLE_CLIENT_ID || '')
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);

        if (!audience.length) {
            return next(new AppError(500, 'error', 'Apple sign-in is not configured'));
        }

        let applePayload: any;
        try {
            applePayload = await appleSignin.verifyIdToken(identityToken, {
                audience,
                ignoreExpiration: false
            });
        } catch (err) {
            return res.status(401).json({ status: 'fail', message: 'Invalid Apple identity token' });
        }

        if (!applePayload || !applePayload.email) {
            return res.status(401).json({ status: 'fail', message: 'Apple token did not include an email' });
        }

        // A staff employee's email signs in as that employee (see findOtpOwner).
        const employee = await findActiveEmployeeByEmail(applePayload.email);
        if (employee) {
            return await sendEmployeeAuthResponse(employee, req, res);
        }
        if (req.body?.accountType === 'professional') {
            return notEmployee(res);
        }

        const firstName = user?.firstName;
        const lastName = user?.lastName;
        const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

        const result = await findOrLinkOrCreateByEmail({
            email: applePayload.email,
            provider: 'apple',
            providerId: applePayload.sub,
            profileHints: {
                name: fullName || undefined,
                firstName,
                lastName
            }
        });

        return sendAuthResponse(res, result, req);
    } catch (error) {
        next(error);
    }
};

/** Locate the User or Company document (if any) currently holding OTP state
 * for this email — used by both otpRequest and otpVerify. */
const findOtpOwner = async (email: string) => {
    // A staff employee's email always signs in as that employee — checked
    // first, so a company admin email that is also its Supervisor (see
    // companyController.ensureDefaultSupervisor) lands in the staff session.
    // The three lookups run together (one wait instead of three in a row —
    // this sits in front of every "send me a code" and every sign-in); the
    // order of preference stays Employee, then User, then Company.
    const otpFields = '+otpCode +otpExpiresAt +otpAttempts +otpResendAt';
    const [employee, user, company] = await Promise.all([
        findActiveEmployeeByEmail(email, otpFields),
        User.findOne({ email }).select(otpFields),
        Company.findOne({ email }).select(otpFields)
    ]);
    if (employee) {
        return { owner: employee, actorKind: 'Employee' };
    }
    const signup = await StaffSignup.findOne({ email, otpExpiresAt: { $gt: new Date() } }).select(otpFields);
    if (signup && signup.otpCode) {
        return { owner: signup, actorKind: 'StaffSignup' };
    }
    if (user) {
        return { owner: user, actorKind: 'User' };
    }
    if (company) {
        return { owner: company, actorKind: 'Company' };
    }
    return { owner: null, actorKind: null };
};

// Corporate employees are a separate collection, matched by a one-way hash of
// the email (the plaintext address is never stored for lookup — see
// utils/pii.ts) rather than a direct `email` field match. Same domain/isActive
// checks as employeeAuthController.otpRequest.
const findActiveEmployeeByEmail = async (email: string, select = '') => {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    const employee = await Employee.findOne({ emailHash: hashEmail(normalized) }).select(select);
    if (employee && employee.emailDomain === emailDomain(normalized) && employee.isActive) {
        return employee;
    }
    return null;
};

// Fills in an Employee's company (name, type) for the sign-in response.
// Mongoose 5 only runs a document's populate() with execPopulate(); without
// it the company stayed a bare id, so the app got no companyName/companyType.
const populateCompany = async (employee: any) => {
    const pending = employee.populate({ path: 'company_id', select: 'name companyType' });
    if (pending && typeof pending.execPopulate === 'function') await pending.execPopulate();
    else await pending;
};

// Registering as a professional (staff) user with an email no company has
// put on its staff list (Staff Management on the admin site).
const notEmployee = (res: any) => res.status(403).json({
    status: 'fail',
    code: 'notEmployee',
    message: 'This email is not registered by a corporation. Please ask your corporation supervisor to register your email address on our admin portal first.'
});

// Signs an Employee in and sends the same envelope sendAuthResponse uses
// (plus actorKind: 'Employee'), so every sign-in method (OTP, Google, Apple)
// and both clients (web + app) handle it the same way.
const sendEmployeeAuthResponse = async (employee: any, req: any, res: any) => {
    employee.lastLoginAt = new Date();
    await employee.save();
    await appendAuditLog(employee._id, 'login', { emailDomain: employee.emailDomain }, req.ip);
    const token = signJwt({ id: employee._id, actorKind: 'Employee', role: employee.role });
    await populateCompany(employee);
    return res.status(200).json({
        status: 'success',
        token,
        user: buildEmployeeResponse(employee),
        actorKind: 'Employee',
        message: 'Login successful'
    });
};

/** Shared by otpRequest (sign in) and signupOtpRequest (sign up): applies the
 * 60-second per-email resend cooldown, generates+stores a fresh code on
 * `owner`, emails it, and sends the standard 200 response. Both callers have
 * already decided whether `owner` should exist at this point. */
const issueOtp = async (owner: any, email: string, res: any) => {
    if (owner.otpResendAt && owner.otpResendAt.getTime() > Date.now()) {
        return res.status(429).json({ status: 'fail', message: 'Please wait before requesting another code' });
    }

    const code = generateOtp();
    const now = Date.now();
    // A direct update of just these four fields: quicker than save() (which
    // re-validates and rewrites the whole document) and it cannot fail on an
    // older account that no longer passes some unrelated validation rule.
    await owner.constructor.updateOne({ _id: owner._id }, {
        $set: {
            otpCode: code,
            otpExpiresAt: new Date(now + OTP_EXPIRY_MINUTES * 60 * 1000),
            otpResendAt: new Date(now + 60 * 1000),
            otpAttempts: 0
        }
    });

    // Fire-and-forget: SMTP takes several seconds, so respond immediately and
    // let delivery finish in the background. A failed send is only logged —
    // the user can use "resend" after the 60-second cooldown.
    sendOtpEmail(email, code).catch((err: any) => console.error('sendOtpEmail failed:', err));

    // Dev convenience only — never log OTP codes outside local/dev.
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[dev-only] OTP code for ${email}: ${code}`);
    }

    return res.status(200).json({ message: 'Code sent' });
};

// POST /auth/otp/request — SIGN IN ONLY. Refuses to send a code (and never
// creates an account) unless this email already belongs to a User or Company —
// new accounts must go through POST /auth/signup/otp/request instead. Mirrors
// the same "admin/self must provision first" principle already used for the
// employee route, just self-service here rather than admin-gated.
exports.otpRequest = async (req: any, res: any, next: any) => {
    try {
        const email = normalizeEmail(req.body?.email);
        if (!email) {
            return res.status(400).json({ status: 'fail', message: 'email is required' });
        }

        const { owner } = await findOtpOwner(email);
        if (!owner) {
            return res.status(404).json({ status: 'fail', message: 'This email is not registered. Please sign up first.' });
        }

        return await issueOtp(owner, email, res);
    } catch (error) {
        next(error);
    }
};

// POST /auth/signup/otp/request — SIGN UP ONLY. Creates a new User shell if
// (and only if) this email isn't already registered; refuses (rather than
// silently logging them in) if it already belongs to a User or Company, so
// signup and sign-in stay distinct actions instead of one implicit fallback.
exports.signupOtpRequest = async (req: any, res: any, next: any) => {
    try {
        const email = normalizeEmail(req.body?.email);
        if (!email) {
            return res.status(400).json({ status: 'fail', message: 'email is required' });
        }

        // Professional (staff) registration: the email must already be on a
        // company's staff list; the code then signs that employee in.
        if (req.body?.accountType === 'professional') {
            const employee = await findActiveEmployeeByEmail(email, '+otpCode +otpExpiresAt +otpAttempts +otpResendAt');
            if (employee) return await issueOtp(employee, email, res);
            // Not on any company's staff list yet: verify the email, then
            // the app's Register Staff Profile page creates the employee.
            let signup = await StaffSignup.findOne({ email }).select('+otpCode +otpExpiresAt +otpAttempts +otpResendAt');
            if (!signup) signup = await StaffSignup.create({ email });
            return await issueOtp(signup, email, res);
        }

        const { owner: existingOwner } = await findOtpOwner(email);
        if (existingOwner) {
            return res.status(409).json({ status: 'fail', message: 'This email is already registered. Please sign in instead.' });
        }

        // profileCompleted stays false so the client routes to profile
        // completion after a successful verify, exactly like today.
        const owner = await User.create({
            name: email.split('@')[0],
            email,
            role: 'User',
            userType: 'client',
            isApproved: false,
            profileCompleted: false,
            emailVerified: false
        });

        return await issueOtp(owner, email, res);
    } catch (error) {
        next(error);
    }
};

// POST /auth/otp/verify — validates the code (5 wrong attempts invalidates it
// entirely, forcing a fresh /auth/otp/request), then finds/links/creates the
// matching User or Company by email via the shared helper.
exports.otpVerify = async (req: any, res: any, next: any) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const code = String(req.body?.code || '').trim();
        if (!email || !code) {
            return res.status(400).json({ status: 'fail', message: 'email and code are required' });
        }

        const { owner, actorKind } = await findOtpOwner(email);

        if (!owner || !owner.otpCode || !owner.otpExpiresAt) {
            return res.status(400).json({ status: 'fail', message: 'No pending code for this email. Request a new one.' });
        }

        if (owner.otpExpiresAt.getTime() < Date.now()) {
            owner.otpCode = undefined;
            owner.otpExpiresAt = undefined;
            owner.otpAttempts = 0;
            owner.otpResendAt = undefined;
            await owner.save();
            return res.status(400).json({ status: 'fail', message: 'Code expired. Request a new one.' });
        }

        const isTestCode = !!TEST_OTP_CODE && code === TEST_OTP_CODE;
        if (owner.otpCode !== code && !isTestCode) {
            owner.otpAttempts = (owner.otpAttempts || 0) + 1;
            if (owner.otpAttempts >= 5) {
                owner.otpCode = undefined;
                owner.otpExpiresAt = undefined;
                owner.otpAttempts = 0;
                owner.otpResendAt = undefined;
                await owner.save();
                return res.status(400).json({ status: 'fail', message: 'Too many attempts. Request a new code.' });
            }
            await owner.save();
            return res.status(400).json({ status: 'fail', message: 'Invalid code' });
        }

        // Correct code.
        owner.otpCode = undefined;
        owner.otpExpiresAt = undefined;
        owner.otpAttempts = 0;
        owner.otpResendAt = undefined;
        owner.emailVerified = true;

        // Employee is a schema-incompatible collection with findOrLinkOrCreateByEmail
        // (User/Company only) — build its response the same way
        // employeeAuthController.otpVerify does, in the same envelope shape
        // sendAuthResponse uses, so the app's existing response handling
        // works unchanged for either actor kind.
        if (actorKind === 'Employee') {
            return await sendEmployeeAuthResponse(owner, req, res);
        }

        // A new staff member: the email is verified; the app now asks for
        // the staff profile (POST /auth/staff/register with this token).
        if (actorKind === 'StaffSignup') {
            await owner.save();
            const registrationToken = jwt.sign({ email, purpose: 'staffSignup' }, process.env.JWT_SECRET, { expiresIn: '30m' });
            return res.status(200).json({ status: 'success', registration: true, registrationToken, email, actorKind: 'StaffSignup' });
        }

        await owner.save();

        const result = await findOrLinkOrCreateByEmail({ email, provider: 'otp' });
        return sendAuthResponse(res, result, req);
    } catch (error) {
        next(error);
    }
};

// POST /auth/profile/complete — requires a valid JWT (req.user set by the
// `protect` middleware). Generalizes the old Google-only completeGoogleProfile
// flow to all 3 passwordless auth methods.
exports.completeProfile = async (req: any, res: any, next: any) => {
    try {
        if (!req.user || req.user.actorKind !== 'User') {
            return next(new AppError(403, 'fail', 'Only user accounts can complete a profile here'));
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return next(new AppError(404, 'fail', 'User not found'));
        }

        const {
            name,
            nickname,
            email,
            gender,
            birthYear,
            country,
            firstName,
            lastName,
            addressStreet,
            addressCity,
            addressState,
            addressZipCode,
            addressCountry,
            phoneNumber,
            dateOfBirth
        } = req.body || {};
        const userType = req.body?.userType || user.userType || 'client';

        if (userType === 'client') {
            // GDPR data minimization: consumers provide exactly nickname/gender/
            // birthYear/country — no name, email, or phone number is ever required here.
            const birthYearNum = Number(birthYear);
            if (!nickname || !gender || !birthYear || !country || Number.isNaN(birthYearNum) || String(birthYear).length !== 4) {
                return res.status(400).json({
                    status: 'fail',
                    message: 'Client requires nickname, gender, birthYear (4-digit year), and country'
                });
            }
        } else if (userType === 'agent') {
            if (!email || !firstName || !lastName || !addressStreet || !addressCity || !addressState || !addressZipCode || !addressCountry || !phoneNumber || !gender || !dateOfBirth) {
                return res.status(400).json({
                    status: 'fail',
                    message: 'Agent requires email, first name, last name, street, city, state, zip code, country, phone number, gender, and date of birth'
                });
            }
        } else {
            return res.status(400).json({ status: 'fail', message: 'Invalid user type' });
        }

        // Face signups arrive with no email at all — the profile page asks for
        // one so the account still has a recovery/contact channel.
        if (!user.email && user.signupMethod === 'face' && !email) {
            return res.status(400).json({ status: 'fail', message: 'Email is required' });
        }
        if (email) {
            const normalized = normalizeEmail(email);
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
                return res.status(400).json({ status: 'fail', message: 'Please enter a valid email address' });
            }
            const owner = await User.findOne({ email: normalized, _id: { $ne: user._id } });
            if (owner) {
                return res.status(409).json({ status: 'fail', message: 'This email is already used by another account' });
            }
        }

        if (name) {
            const normalizedName = normalizeUsername(name);
            if (normalizedName) user.name = normalizedName;
        }
        if (email) {
            user.email = normalizeEmail(email);
        }

        user.userType = userType;
        user.gender = gender;

        if (userType === 'client') {
            user.nickname = normalizeUsername(nickname);
            user.birthYear = Number(birthYear);
            user.country = country;
        } else {
            user.firstName = firstName;
            user.lastName = lastName;
            user.addressStreet = addressStreet;
            user.addressCity = addressCity;
            user.addressState = addressState;
            user.addressZipCode = addressZipCode;
            user.addressCountry = addressCountry;
            user.address = `${addressStreet}, ${addressCity}, ${addressState}, ${addressZipCode}, ${addressCountry}`;
            user.phoneNumber = phoneNumber;
            user.dateOfBirth = dateOfBirth;
        }

        user.profileCompleted = true;
        await user.save();

        const token = signJwt({ id: user._id, name: user.name, actorKind: 'User' });

        return res.status(200).json({
            status: 'success',
            token,
            user: buildUserResponse(user),
            actorKind: 'User',
            message: 'Profile completed successfully'
        });
    } catch (error) {
        next(error);
    }
};

// POST /auth/device-token — requires a valid JWT. Registers the Expo/FCM push
// token as the sole channel used to reach a consumer, per the GDPR brief
// ("Device Token obtained here will be the only key to communicate with the user").
exports.registerDeviceToken = async (req: any, res: any, next: any) => {
    try {
        if (!req.user || req.user.actorKind !== 'User') {
            return next(new AppError(403, 'fail', 'Only user accounts can register a device token'));
        }

        const deviceToken = String(req.body?.deviceToken || '').trim();
        if (!deviceToken) {
            return res.status(400).json({ status: 'fail', message: 'deviceToken is required' });
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return next(new AppError(404, 'fail', 'User not found'));
        }

        user.deviceToken = deviceToken;
        user.pushConsent = true;
        await user.save();

        return res.status(200).json({ status: 'success', message: 'Device token registered' });
    } catch (error) {
        next(error);
    }
};

// POST /auth/ai-concierge-consent — requires a valid JWT. Records the user's
// choice on AI Concierge personalization (learning from scans/favorites/
// browsing history, shared with participating brands for recommendations).
// Shown once after first login (see LoginScreen/RegisterScreen client-side)
// and reopenable any time via "Privacy Preferences" to change or withdraw —
// both cases land here, since it's just "set the current choice, record when".
// `consent` may be true or false: declining is itself a valid, recorded
// decision (that's what `aiConciergeConsentAt` being set tracks), not an error.
exports.aiConciergeConsent = async (req: any, res: any, next: any) => {
    try {
        if (!req.user || req.user.actorKind !== 'User') {
            return next(new AppError(403, 'fail', 'Only user accounts can set this preference'));
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return next(new AppError(404, 'fail', 'User not found'));
        }

        user.aiConciergeConsent = !!req.body?.consent;
        user.aiConciergeConsentAt = new Date();
        await user.save();

        return res.status(200).json({
            status: 'success',
            user: buildUserResponse(user),
            message: 'Preference saved'
        });
    } catch (error) {
        next(error);
    }
};

// ---------------------------------------------------------------------------
// Face sign-in (self-hosted CompreFace — see utils/compreface.ts and
// deploy/compreface/install.sh). The app captures one photo after its own
// blink + liveness check and posts it here; matching happens only on the
// server, so a modified app can't just claim "this is user X".
// ---------------------------------------------------------------------------
const CompreFace = require('../utils/compreface');
const fs = require('fs');
const path = require('path');
const uniqid = require('uniqid');

const FACE_ERRORS: Record<string, { status: number; message: string }> = {
    notConfigured: { status: 503, message: 'Face sign-in is not configured on the server' },
    badImage: { status: 400, message: 'A face photo is required' },
    noFace: { status: 422, message: 'No face found. Look straight at the camera and try again.' },
    manyFaces: { status: 422, message: 'Only one person should be in the picture.' },
    failed: { status: 502, message: 'Face check did not work. Please try again.' }
};
const faceFail = (res: any, key: string) => res.status(FACE_ERRORS[key].status).json({ status: 'fail', code: key, message: FACE_ERRORS[key].message });

// CompreFace subject names: a User's _id as-is (as since face sign-in
// began), an Employee's _id as "employee-<id>".
const EMPLOYEE_SUBJECT_PREFIX = 'employee-';
const faceSubjectFor = (actorKind: string, id: any) => (actorKind === 'Employee' ? `${EMPLOYEE_SUBJECT_PREFIX}${id}` : String(id));

/** The account a CompreFace subject belongs to, if it still has a face registered. */
const findFaceOwner = async (subject: string) => {
    try {
        if (subject.startsWith(EMPLOYEE_SUBJECT_PREFIX)) {
            const doc = await Employee.findOne({ _id: subject.slice(EMPLOYEE_SUBJECT_PREFIX.length), faceEnrolledAt: { $exists: true }, isActive: true });
            return doc ? { actorKind: 'Employee', doc } : null;
        }
        const doc = await User.findOne({ _id: subject, faceEnrolledAt: { $exists: true } });
        return doc ? { actorKind: 'User', doc } : null;
    } catch (err) {
        // A subject that isn't a valid id (left over from tests) matches nobody.
        return null;
    }
};

/** Saves the face photo in uploads/ (bare filename, like /upload/single) for use as the profile picture. */
const saveFacePhoto = (b64: string): string | null => {
    try {
        const filename = `${Date.now()}${uniqid()}.jpg`;
        fs.writeFileSync(path.join(__dirname, '../uploads', filename), Buffer.from(b64, 'base64'));
        return filename;
    } catch (err) {
        console.error('Saving face photo failed:', err);
        return null;
    }
};

// POST /auth/face/enroll { image } — signed in (User or Employee): register
// this person's face so they can use Face login, or replace it ("reset my
// face" from the profile page). The photo becomes their profile picture.
// Refused when the face already belongs to a different account.
exports.faceEnroll = async (req: any, res: any, next: any) => {
    try {
        const actorKind = req.user?.actorKind;
        if (actorKind !== 'User' && actorKind !== 'Employee') {
            return res.status(403).json({ status: 'fail', message: 'Only app accounts can register a face' });
        }
        if (!CompreFace.isConfigured()) return faceFail(res, 'notConfigured');
        const b64 = CompreFace.toBase64Image(req.body?.image);
        if (!b64) return faceFail(res, 'badImage');

        const Model = actorKind === 'Employee' ? Employee : User;
        const actor = await Model.findById(req.user.id);
        if (!actor) {
            return res.status(404).json({ status: 'fail', message: 'Account not found' });
        }
        const subject = faceSubjectFor(actorKind, actor._id);

        const match = await CompreFace.recognize(b64);
        if (match.error) return faceFail(res, match.error);
        if (match.faces > 1) return faceFail(res, 'manyFaces');
        if (match.subject && match.subject !== subject && match.similarity >= CompreFace.similarityThreshold()) {
            if (await findFaceOwner(match.subject)) {
                return res.status(409).json({ status: 'fail', code: 'duplicate', message: 'This face is already registered to another account.' });
            }
        }

        // Re-registering replaces the old face rather than adding to it.
        if (actor.faceEnrolledAt) await CompreFace.deleteSubject(subject);
        const added = await CompreFace.addFace(subject, b64);
        if (added.error) return faceFail(res, added.error);

        actor.faceEnrolledAt = new Date();
        const filename = saveFacePhoto(b64);
        if (filename) actor.avatar = filename;
        await actor.save();

        if (actorKind === 'Employee') {
            await populateCompany(actor);
            return res.status(200).json({ status: 'success', actorKind, user: buildEmployeeResponse(actor), avatar: actor.avatar, faceEnrolled: true });
        }
        return res.status(200).json({ status: 'success', actorKind, user: buildUserResponse(actor), avatar: actor.avatar, faceEnrolled: true });
    } catch (error) {
        next(error);
    }
};

// ---------------------------------------------------------------------------
// This device (see models/appDeviceModel.ts).
// ---------------------------------------------------------------------------
const AppDevice = require('../models/appDeviceModel');

const cleanDeviceId = (v: any) => {
    const id = typeof v === 'string' ? v.trim() : '';
    return /^[A-Za-z0-9_-]{16,80}$/.test(id) ? id : '';
};
const clip = (v: any, max: number) => (v == null ? undefined : String(v).slice(0, max));

// GET /auth/device/:deviceId — has an account finished registering or
// signing in on this device, and does one of them have a face registered?
exports.deviceStatus = async (req: any, res: any, next: any) => {
    try {
        const deviceId = cleanDeviceId(req.params.deviceId);
        if (!deviceId) return res.status(400).json({ status: 'fail', message: 'Invalid device id' });
        const device = await AppDevice.findOne({ deviceId }).lean();
        if (!device) return res.status(200).json({ status: 'success', registered: false, faceEnrolled: false });

        const ids = (kind: string) => (device.accounts || []).filter((a: any) => a.actorKind === kind).map((a: any) => a.actorId);
        const [userFace, employeeFace] = await Promise.all([
            User.exists({ _id: { $in: ids('User') }, faceEnrolledAt: { $exists: true } }),
            Employee.exists({ _id: { $in: ids('Employee') }, faceEnrolledAt: { $exists: true }, isActive: true })
        ]);
        await AppDevice.updateOne({ _id: device._id }, { $set: { lastSeenAt: new Date() } });
        return res.status(200).json({ status: 'success', registered: true, faceEnrolled: !!(userFace || employeeFace) });
    } catch (error) {
        next(error);
    }
};

// POST /auth/device { deviceId, platform, model, osVersion, appVersion } —
// signed in: remember that this account registered / signed in on this device.
exports.registerDevice = async (req: any, res: any, next: any) => {
    try {
        const actorKind = req.user?.actorKind;
        if (actorKind !== 'User' && actorKind !== 'Employee') {
            return res.status(403).json({ status: 'fail', message: 'Only app accounts can register a device' });
        }
        const deviceId = cleanDeviceId(req.body?.deviceId);
        if (!deviceId) return res.status(400).json({ status: 'fail', message: 'Invalid device id' });

        const now = new Date();
        const info = {
            platform: clip(req.body?.platform, 20),
            model: clip(req.body?.model, 100),
            osVersion: clip(req.body?.osVersion, 50),
            appVersion: clip(req.body?.appVersion, 30),
            userAgent: clip(req.headers['user-agent'], 300),
            lastActorKind: actorKind,
            lastActorId: req.user.id,
            lastSeenAt: now
        };
        // Known account on this device: refresh it; otherwise add it.
        const updated = await AppDevice.updateOne(
            { deviceId, accounts: { $elemMatch: { actorKind, actorId: req.user.id } } },
            { $set: { ...info, 'accounts.$.lastAt': now } }
        );
        if (!updated.matchedCount) {
            await AppDevice.updateOne(
                { deviceId },
                { $set: info, $push: { accounts: { actorKind, actorId: req.user.id, firstAt: now, lastAt: now } } },
                { upsert: true }
            );
        }
        return res.status(200).json({ status: 'success', registered: true });
    } catch (error) {
        next(error);
    }
};

// POST /auth/face/signup { image } — create the account, enroll its face in
// CompreFace (subject = the new User id), then start the session.
// profileCompleted stays false, so the app shows the profile page next
// (where face accounts add their email).
exports.faceSignup = async (req: any, res: any, next: any) => {
    try {
        if (!CompreFace.isConfigured()) return faceFail(res, 'notConfigured');
        const b64 = CompreFace.toBase64Image(req.body?.image);
        if (!b64) return faceFail(res, 'badImage');

        const match = await CompreFace.recognize(b64);
        if (match.error) return faceFail(res, match.error);
        if (match.faces > 1) return faceFail(res, 'manyFaces');
        if (match.subject && match.similarity >= CompreFace.similarityThreshold()) {
            const existing = await User.findOne({ _id: match.subject, faceEnrolledAt: { $exists: true } });
            if (existing) {
                return res.status(409).json({ status: 'fail', code: 'duplicate', message: 'This face is already registered. Please sign in instead.' });
            }
        }

        const user = await User.create({
            role: 'User',
            userType: 'client',
            isApproved: false,
            profileCompleted: false,
            signupMethod: 'face'
        });
        const added = await CompreFace.addFace(String(user._id), b64);
        if (added.error) {
            await User.deleteOne({ _id: user._id });
            return faceFail(res, added.error);
        }
        user.faceEnrolledAt = new Date();
        // The signup photo also becomes the profile picture (same uploads
        // folder + bare-filename convention as /upload/single).
        try {
            const filename = `${Date.now()}${uniqid()}.jpg`;
            fs.writeFileSync(path.join(__dirname, '../uploads', filename), Buffer.from(b64, 'base64'));
            user.avatar = filename;
        } catch (err) {
            console.error('Saving face avatar failed:', err);
        }
        await user.save();

        const token = signJwt({ id: user._id, name: user.name, actorKind: 'User' });
        return sendAuthResponse(res, { actorKind: 'User', actor: user, token }, req);
    } catch (error) {
        next(error);
    }
};

// POST /auth/face/login { image } — find whose face this is and sign them in.
exports.faceLogin = async (req: any, res: any, next: any) => {
    try {
        if (!CompreFace.isConfigured()) return faceFail(res, 'notConfigured');
        const b64 = CompreFace.toBase64Image(req.body?.image);
        if (!b64) return faceFail(res, 'badImage');

        const match = await CompreFace.recognize(b64);
        if (match.error) return faceFail(res, match.error);
        if (match.faces > 1) return faceFail(res, 'manyFaces');

        const owner = match.subject && match.similarity >= CompreFace.similarityThreshold()
            ? await findFaceOwner(match.subject)
            : null;
        if (owner && owner.actorKind === 'Employee') {
            return await sendEmployeeAuthResponse(owner.doc, req, res);
        }
        const user = owner ? owner.doc : null;
        if (!user) {
            return res.status(404).json({ status: 'fail', code: 'unrecognized', message: 'Face not recognised. Try again or sign up first.' });
        }
        const token = signJwt({ id: user._id, name: user.name, actorKind: 'User' });
        return sendAuthResponse(res, { actorKind: 'User', actor: user, token }, req);
    } catch (error) {
        next(error);
    }
};


// GET /auth/staff/companies — the brand companies a new staff member can
// choose on Register Staff Profile (names only).
exports.staffCompanies = async (req: any, res: any, next: any) => {
    try {
        const companies = await Company.find({ role: { $ne: 'super' }, name: { $ne: 'admin' } }).select('name').sort({ name: 1 }).lean();
        const Brand = require('../models/brandModel');
        const brands = await Brand.find({ company_id: { $in: companies.map((c: any) => c._id) } }).sort({ createdAt: 1 }).select('company_id name').lean();
        const brandName = new Map<string, string>();
        brands.forEach((b: any) => { if (!brandName.has(String(b.company_id))) brandName.set(String(b.company_id), b.name); });
        res.status(200).json({ status: 'success', data: companies.map((c: any) => ({ _id: c._id, name: brandName.get(String(c._id)) || c.name })) });
    } catch (error) {
        next(error);
    }
};

// POST /auth/staff/register { registrationToken, name, employeeCode,
// company_id, employeeType: 'working_employee' | 'supervisor', password }
// — a new staff member whose email was verified with a code. Creates the
// Employee and signs them in. The employee ID must not be registered yet.
// A Supervisor must use an email at the company's staff email domain when
// the company has set one (so nobody can make themselves a brand's
// Supervisor with any email).
exports.staffRegister = async (req: any, res: any, next: any) => {
    try {
        let claims: any = null;
        try {
            claims = jwt.verify(String(req.body?.registrationToken || ''), process.env.JWT_SECRET);
        } catch (e) {
            claims = null;
        }
        if (!claims || claims.purpose !== 'staffSignup' || !claims.email) {
            return res.status(401).json({ status: 'fail', message: 'Your email check has expired. Please register again.' });
        }
        const email = normalizeEmail(claims.email);
        const name = String(req.body?.name || '').trim().slice(0, 100);
        const employeeCode = String(req.body?.employeeCode || '').trim().slice(0, 60);
        const companyId = String(req.body?.company_id || '');
        const employeeType = req.body?.employeeType === 'supervisor' ? 'supervisor' : 'working_employee';
        const password = String(req.body?.password || '');
        if (!name) return res.status(400).json({ status: 'fail', field: 'name', message: 'Please enter your full name.' });
        if (!employeeCode) return res.status(400).json({ status: 'fail', field: 'employeeCode', message: 'Please enter your employee ID.' });
        const problem = passwordProblem(password);
        if (problem) return res.status(400).json({ status: 'fail', field: 'password', message: problem });
        if (!mongoose.Types.ObjectId.isValid(companyId)) return res.status(400).json({ status: 'fail', field: 'company', message: 'Please choose your company.' });
        const company = await Company.findById(companyId).select('name role allowedEmailDomains');
        if (!company || company.role === 'super') return res.status(400).json({ status: 'fail', field: 'company', message: 'Please choose your company.' });

        if (await Employee.exists({ emailHash: hashEmail(email) })) {
            return res.status(409).json({ status: 'fail', message: 'This email is already registered. Please sign in instead.' });
        }
        const codeKey = employeeCode.toLowerCase();
        const taken = await Employee.findOne({ employeeCode: { $regex: `^${codeKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }).select('_id').lean();
        if (taken) {
            return res.status(409).json({ status: 'fail', field: 'employeeCode', message: 'This employee ID is already registered. Check it, or ask your Supervisor.' });
        }
        const domains = (company.allowedEmailDomains || []).map((d: string) => String(d).toLowerCase());
        if (employeeType === 'supervisor' && domains.length && !domains.includes(emailDomain(email))) {
            return res.status(403).json({ status: 'fail', field: 'role', message: `To register as a Supervisor of ${company.name}, use your work email at ${domains.map((d: string) => '@' + d).join(' or ')}.` });
        }

        const employee = await Employee.create({
            emailHash: hashEmail(email),
            email,
            emailDomain: emailDomain(email),
            company_id: company._id,
            employeeCode,
            name,
            role: 'staff',
            employeeType,
            isActive: true,
            passwordHash: hashPassword(password),
            profileCompletedAt: new Date()
        });
        await StaffSignup.deleteOne({ email });
        await appendAuditLog(employee._id, 'self_register', { emailDomain: employee.emailDomain }, req.ip);
        return await sendEmployeeAuthResponse(employee, req, res);
    } catch (error) {
        next(error);
    }
};

// POST /auth/staff/login { email, password } — Staff Sign In.
exports.staffLogin = async (req: any, res: any, next: any) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const password = String(req.body?.password || '');
        if (!email || !password) return res.status(400).json({ status: 'fail', message: 'Please enter your work email and password.' });
        const employee = await findActiveEmployeeByEmail(email, '+passwordHash');
        if (!employee || !employee.passwordHash || !verifyPassword(password, employee.passwordHash)) {
            return res.status(401).json({
                status: 'fail',
                code: employee && !employee.passwordHash ? 'noPassword' : 'badLogin',
                message: employee && !employee.passwordHash
                    ? 'This account has no password yet. Sign in with an email code, then set one in your profile.'
                    : 'The email or password is not right.'
            });
        }
        return await sendEmployeeAuthResponse(employee, req, res);
    } catch (error) {
        next(error);
    }
};
