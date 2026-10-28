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

// Signs an Employee in and sends the same envelope sendAuthResponse uses
// (plus actorKind: 'Employee'), so every sign-in method (OTP, Google, Apple)
// and both clients (web + app) handle it the same way.
const sendEmployeeAuthResponse = async (employee: any, req: any, res: any) => {
    employee.lastLoginAt = new Date();
    await employee.save();
    await appendAuditLog(employee._id, 'login', { emailDomain: employee.emailDomain }, req.ip);
    const token = signJwt({ id: employee._id, actorKind: 'Employee', role: employee.role });
    await employee.populate({ path: 'company_id', select: 'name' });
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
// Face sign-in (FACEIO, https://faceio.net). The fio.js widget in the app
// does the camera capture, face matching and (on FACEIO's Pro plan and up)
// anti-spoofing; it hands the app a Facial ID. That ID alone proves nothing
// — anyone could post a copied one — so before trusting it the backend
// confirms it with FACEIO itself, using whichever of these is configured:
//
//   FACEIO_WEBHOOK_TOKEN  FACEIO posts an ENROLL/AUTH event to
//                         POST /auth/face/webhook for every real enroll/
//                         authenticate. Sign-in then requires a fresh,
//                         unused event for that Facial ID (one event = one
//                         sign-in), which is what makes a copied ID useless.
//   FACEIO_API_KEY        REST `checkfacialid` — confirms the ID is enrolled
//                         in our FACEIO application (paid plans only).
//
// With neither set, face sign-in is refused unless FACEIO_ALLOW_UNVERIFIED
// is 'true' — a local-testing escape hatch that must stay off in production.
// ---------------------------------------------------------------------------
const FaceEvent = require('../models/faceEventModel');
const jwtLib = require('jsonwebtoken');

const FACE_EVENT_MAX_AGE_MS = 2 * 60 * 1000;
const FACE_EVENT_WAIT_MS = 6000;
const FACE_SIGNUP_TICKET_PURPOSE = 'face-signup';

const isValidFacialId = (v: any) => typeof v === 'string' && /^[A-Za-z0-9._:-]{8,200}$/.test(v);

const checkFacialIdWithRest = async (facialId: string) => {
    const fetchFn = require('node-fetch');
    const url = `https://api.faceio.net/checkfacialid?fid=${encodeURIComponent(facialId)}&key=${encodeURIComponent(process.env.FACEIO_API_KEY || '')}`;
    const r = await fetchFn(url, { timeout: 8000 });
    const j: any = await r.json().catch(() => ({}));
    return r.ok && j?.valid === true;
};

// Waits briefly for the matching webhook — FACEIO sends it at about the same
// moment fio.js resolves in the browser, so it can land a beat after the
// app's own request.
const consumeFaceEvent = async (facialId: string, eventName: 'ENROLL' | 'AUTH') => {
    const deadline = Date.now() + FACE_EVENT_WAIT_MS;
    for (;;) {
        const ev = await FaceEvent.findOneAndUpdate(
            {
                facialId,
                eventName,
                consumedAt: { $exists: false },
                createdAt: { $gte: new Date(Date.now() - FACE_EVENT_MAX_AGE_MS) }
            },
            { $set: { consumedAt: new Date() } },
            { sort: { createdAt: -1 }, new: true }
        );
        if (ev) return true;
        if (Date.now() >= deadline) return false;
        await new Promise((r) => setTimeout(r, 750));
    }
};

/** Returns null when the Facial ID checks out, otherwise an error message. */
const verifyFacialId = async (facialId: string, eventName: 'ENROLL' | 'AUTH') => {
    const useWebhook = !!process.env.FACEIO_WEBHOOK_TOKEN;
    const useRest = !!process.env.FACEIO_API_KEY;
    if (!useWebhook && !useRest) {
        return process.env.FACEIO_ALLOW_UNVERIFIED === 'true' ? null : 'Face sign-in is not configured on the server';
    }
    if (useRest && !(await checkFacialIdWithRest(facialId))) {
        return 'Face not recognised';
    }
    if (useWebhook && !(await consumeFaceEvent(facialId, eventName))) {
        return 'Face check could not be confirmed. Please try again.';
    }
    return null;
};

// POST /auth/face/signup/start — step 1 of face signup: creates the (still
// incomplete) account and returns its id for fio.js enroll()'s payload, plus
// a short-lived ticket that only /face/signup/complete accepts.
exports.faceSignupStart = async (req: any, res: any, next: any) => {
    try {
        const user = await User.create({
            role: 'User',
            userType: 'client',
            isApproved: false,
            profileCompleted: false,
            signupMethod: 'face'
        });
        const ticket = jwtLib.sign(
            { id: String(user._id), purpose: FACE_SIGNUP_TICKET_PURPOSE },
            process.env.JWT_SECRET,
            { expiresIn: '15m' }
        );
        return res.status(200).json({ status: 'success', userId: String(user._id), signupTicket: ticket });
    } catch (error) {
        next(error);
    }
};

// POST /auth/face/signup/complete { signupTicket, facialId } — step 2: after
// fio.js enroll() succeeded, attach the confirmed Facial ID to the account
// and start the session (profileCompleted is still false, so the app shows
// the profile page next).
exports.faceSignupComplete = async (req: any, res: any, next: any) => {
    try {
        const { signupTicket, facialId } = req.body || {};
        if (!signupTicket || !isValidFacialId(facialId)) {
            return res.status(400).json({ status: 'fail', message: 'signupTicket and facialId are required' });
        }
        let decoded: any;
        try {
            decoded = jwtLib.verify(signupTicket, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ status: 'fail', message: 'Signup expired. Please start again.' });
        }
        if (decoded?.purpose !== FACE_SIGNUP_TICKET_PURPOSE) {
            return res.status(401).json({ status: 'fail', message: 'Invalid signup ticket' });
        }

        const verifyError = await verifyFacialId(facialId, 'ENROLL');
        if (verifyError) {
            return res.status(401).json({ status: 'fail', message: verifyError });
        }

        const taken = await User.findOne({ faceioFacialId: facialId, _id: { $ne: decoded.id } });
        if (taken) {
            return res.status(409).json({ status: 'fail', message: 'This face is already registered. Please sign in instead.' });
        }

        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(404).json({ status: 'fail', message: 'Signup expired. Please start again.' });
        }
        if (user.faceioFacialId && user.faceioFacialId !== facialId) {
            return res.status(409).json({ status: 'fail', message: 'This account already has a face registered' });
        }
        user.faceioFacialId = facialId;
        await user.save();

        const token = signJwt({ id: user._id, name: user.name, actorKind: 'User' });
        return sendAuthResponse(res, { actorKind: 'User', actor: user, token }, req);
    } catch (error) {
        next(error);
    }
};

// POST /auth/face/login { facialId } — after fio.js authenticate() matched a
// face, confirm it with FACEIO and sign in the account it belongs to.
exports.faceLogin = async (req: any, res: any, next: any) => {
    try {
        const { facialId } = req.body || {};
        if (!isValidFacialId(facialId)) {
            return res.status(400).json({ status: 'fail', message: 'facialId is required' });
        }
        const verifyError = await verifyFacialId(facialId, 'AUTH');
        if (verifyError) {
            return res.status(401).json({ status: 'fail', message: verifyError });
        }
        const user = await User.findOne({ faceioFacialId: facialId });
        if (!user) {
            return res.status(404).json({ status: 'fail', message: 'No account uses this face yet. Please sign up first.' });
        }
        const token = signJwt({ id: user._id, name: user.name, actorKind: 'User' });
        return sendAuthResponse(res, { actorKind: 'User', actor: user, token }, req);
    } catch (error) {
        next(error);
    }
};

// POST /auth/face/webhook — FACEIO's ENROLL / AUTH / DELETION callback.
// FACEIO authenticates itself with `WWW-Authenticate: Bearer <token key>`
// (the token shown in its Application Manager), not an HMAC signature.
exports.faceWebhook = async (req: any, res: any, next: any) => {
    try {
        const expected = process.env.FACEIO_WEBHOOK_TOKEN;
        const header = String(req.headers?.['www-authenticate'] || req.headers?.authorization || '');
        const presented = header.replace(/^Bearer\s+/i, '').trim();
        if (!expected || presented !== expected) {
            return res.status(401).json({ status: 'fail' });
        }
        const { eventName, facialId, clientIp, payload } = req.body || {};
        if (!isValidFacialId(facialId) || !eventName) {
            return res.status(400).json({ status: 'fail' });
        }
        if (eventName === 'DELETION') {
            await User.updateOne({ faceioFacialId: facialId }, { $unset: { faceioFacialId: 1 } });
        } else if (eventName === 'ENROLL' || eventName === 'AUTH') {
            await FaceEvent.create({ eventName, facialId, clientIp: clientIp || '', payload });
        }
        return res.status(200).json({ status: 'success' });
    } catch (error) {
        next(error);
    }
};
